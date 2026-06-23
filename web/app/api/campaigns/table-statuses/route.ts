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

  // Low-cardinality column → bounded scan + JS dedupe is enough (PostgREST has
  // no DISTINCT). Cap the distinct set so a misconfigured column can't flood
  // the prompt.
  const { data: rows, error } = await sb
    .from(physicalTable)
    .select(statusColumn)
    .not(statusColumn, "is", null)
    .limit(5000);
  if (error) return NextResponse.json({ column: statusColumn, values: [] });

  const seen = new Set<string>();
  for (const row of rows ?? []) {
    const raw = (row as unknown as Record<string, unknown>)[statusColumn];
    if (raw == null) continue;
    const v = String(raw).trim();
    if (v) seen.add(v);
    if (seen.size >= 50) break;
  }

  return NextResponse.json({ column: statusColumn, values: Array.from(seen).sort() });
}
