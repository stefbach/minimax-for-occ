import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Distinct values + counts for one or more columns of a data table, scoped to
 * the caller's org. Powers the human-campaign "Qui appeler" pickers in the
 * wizard: choose which qualification(s) and/or which assignment bucket(s)
 * (the `agent` column) feed the agent's campaign. Counts matter because the
 * assignment column often holds opaque ids — the operator recognises a bucket
 * by its size.
 *
 * GET /api/campaigns/table-facets?data_table_id=<uuid>&columns=qualification,agent
 *  → { facets: { qualification: [{value,count}], agent: [{value,count}] } }
 *
 * Columns are validated against the table's declared `columns` config, so the
 * caller can't read an arbitrary column.
 */
const MAX_DISTINCT = 80;
// Upper bound on rows paged through per column (50 pages × 1000), so a huge
// table can't make this endpoint run unbounded.
const MAX_SCAN = 50000;

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ facets: {} });

  const url = new URL(req.url);
  const dataTableId = url.searchParams.get("data_table_id");
  const columnsParam = url.searchParams.get("columns") ?? "";
  if (!dataTableId) {
    return NextResponse.json({ error: "data_table_id requis" }, { status: 400 });
  }

  const org_id = await requestOrgId(req);
  const sb = supabaseServer();

  const { data: dt } = await sb
    .from("tenant_data_tables")
    .select("physical_table, columns")
    .eq("id", dataTableId)
    .eq("org_id", org_id)
    .maybeSingle();
  if (!dt) return NextResponse.json({ error: "table introuvable" }, { status: 404 });

  const declared = ((dt as { columns?: Array<{ key: string }> }).columns ?? []).map((c) => c.key);
  const allowed = new Set(declared);
  const physicalTable = (dt as { physical_table: string }).physical_table;

  const requested = columnsParam
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && allowed.has(c))
    .slice(0, 5);

  const facets: Record<string, Array<{ value: string; count: number }>> = {};
  for (const col of requested) {
    // PostgREST has no GROUP BY and caps a single response (~1000 rows), so a
    // one-shot scan tallies only the first page — missing most values on a big
    // table. Page through the whole column so the counts are complete.
    const tally = new Map<string, number>();
    const PAGE = 1000;
    let failed = false;
    for (let from = 0; from < MAX_SCAN; from += PAGE) {
      const { data: rows, error } = await sb
        .from(physicalTable)
        .select(col)
        .not(col, "is", null)
        .order(col, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { failed = true; break; }
      const batch = (rows ?? []) as unknown as Array<Record<string, unknown>>;
      for (const row of batch) {
        const raw = row[col];
        if (raw == null) continue;
        const v = String(raw).trim();
        if (!v) continue;
        tally.set(v, (tally.get(v) ?? 0) + 1);
      }
      if (batch.length < PAGE) break; // last page
    }
    if (failed && tally.size === 0) {
      facets[col] = [];
      continue;
    }
    facets[col] = Array.from(tally.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_DISTINCT);
  }

  return NextResponse.json({ facets });
}
