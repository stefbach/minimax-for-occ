import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Distinct values of a data table's status column, scoped to the caller's org.
 *
 * Feeds the scheduling chatbot so it maps the operator's free-text ("les
 * nouveaux", "les no-shows") onto the EXACT values stored in THIS client's
 * table — whatever their business vocabulary. Without this the agent guesses
 * and can produce a syntactically valid but empty selection.
 *
 * GET /api/campaigns/table-statuses?data_table_id=<uuid>&column=<key>
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ values: [] });

  const url = new URL(req.url);
  const dataTableId = url.searchParams.get("data_table_id");
  const requestedColumn = url.searchParams.get("column");
  if (!dataTableId) {
    return NextResponse.json({ error: "data_table_id requis" }, { status: 400 });
  }

  const org_id = await requestOrgId(req);
  const sb = supabaseServer();

  // Verify the table belongs to the caller's org before touching it.
  const { data: dt } = await sb
    .from("tenant_data_tables")
    .select("physical_table, columns")
    .eq("id", dataTableId)
    .eq("org_id", org_id)
    .maybeSingle();
  if (!dt) return NextResponse.json({ error: "table introuvable" }, { status: 404 });

  const columns = ((dt as { columns?: Array<{ key: string; type: string }> }).columns ?? []);
  const columnKeys = new Set(columns.map((c) => c.key));

  // Pick the status column: the explicit param (validated) or a heuristic.
  const statusColumn =
    requestedColumn && columnKeys.has(requestedColumn)
      ? requestedColumn
      : columns.find((c) => /qualif|status|statut|stage/i.test(c.key))?.key ?? null;

  if (!statusColumn) return NextResponse.json({ column: null, values: [] });

  const physicalTable = (dt as { physical_table: string }).physical_table;

  // Low-cardinality column → page through it (PostgREST caps a single response
  // at ~1000 rows, and reading one page would miss most statuses on a big
  // table). Cap the distinct set so a misconfigured column can't flood the
  // prompt, and bound the scan so a huge table can't run unbounded.
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; from < 50000 && seen.size < 50; from += PAGE) {
    const { data: rows, error } = await sb
      .from(physicalTable)
      .select(statusColumn)
      .not(statusColumn, "is", null)
      .order(statusColumn, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = (rows ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of batch) {
      const raw = row[statusColumn];
      if (raw == null) continue;
      const v = String(raw).trim();
      if (v) seen.add(v);
      if (seen.size >= 50) break;
    }
    if (batch.length < PAGE) break;
  }

  return NextResponse.json({ column: statusColumn, values: Array.from(seen).sort() });
}
