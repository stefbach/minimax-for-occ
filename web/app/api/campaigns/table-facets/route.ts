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
    // PostgREST has no GROUP BY; bounded scan + JS tally is fine for a
    // low-cardinality status/assignment column.
    const { data: rows, error } = await sb
      .from(physicalTable)
      .select(col)
      .not(col, "is", null)
      .limit(20000);
    if (error) {
      facets[col] = [];
      continue;
    }
    const tally = new Map<string, number>();
    for (const row of rows ?? []) {
      const raw = (row as unknown as Record<string, unknown>)[col];
      if (raw == null) continue;
      const v = String(raw).trim();
      if (!v) continue;
      tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    facets[col] = Array.from(tally.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_DISTINCT);
  }

  return NextResponse.json({ facets });
}
