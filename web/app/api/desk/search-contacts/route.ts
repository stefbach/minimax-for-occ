import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/search-contacts?q=nathalie+maitre&limit=6
 *
 * Searches contacts by display_name (Axon CRM contacts table) AND by name
 * across all tenant_data_tables (e.g. leads_rdv). This ensures patients who
 * exist only in a leads table — not yet in the CRM contacts table — are still
 * discoverable from the dashboard patient search bar.
 *
 * Returns: Array<{ id, display_name, e164, table_id? }>
 *   - table_id is set for leads-table results; absent for CRM contact results.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ contacts: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ contacts: [] });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ contacts: [] });
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit") ?? "6")));

  const admin = supabaseServer();

  // ── 1. Search Axon CRM contacts table ───────────────────────────────────
  const { data: crmContacts } = await admin
    .from("contacts")
    .select("id, display_name, e164")
    .eq("org_id", orgId)
    .ilike("display_name", `%${q}%`)
    .limit(limit);

  const results: Array<{ id: string; display_name: string | null; e164: string | null; table_id?: string }> =
    (crmContacts ?? []).map((c) => ({ id: c.id, display_name: c.display_name, e164: c.e164 }));

  // ── 2. Search tenant data tables (leads_rdv, etc.) ──────────────────────
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("id, physical_table, name_column, phone_column")
    .eq("org_id", orgId);

  const seenIds = new Set<string>(results.map((r) => r.id));

  for (const table of tables ?? []) {
    if (!table.name_column) continue;

    // Build select string — always id + name, optionally phone
    const cols = ["id", table.name_column];
    if (table.phone_column) cols.push(table.phone_column);

    // Search by name (case-insensitive substring)
    const { data: byName } = await admin
      .from(table.physical_table as never)
      .select(cols.join(", "))
      .ilike(table.name_column, `%${q}%`)
      .limit(limit);

    for (const row of byName ?? []) {
      const r = row as Record<string, unknown>;
      const rowId = String(r["id"]);
      if (seenIds.has(rowId)) continue;
      seenIds.add(rowId);
      results.push({
        id: rowId,
        display_name: (r[table.name_column] as string | null) ?? null,
        e164: table.phone_column ? (r[table.phone_column] as string | null) ?? null : null,
        table_id: table.id,
      });
    }

    // Also search by phone if the query looks like a number
    if (table.phone_column && /^[+\d][\d\s\-().]{2,}/.test(q)) {
      const { data: byPhone } = await admin
        .from(table.physical_table as never)
        .select(cols.join(", "))
        .ilike(table.phone_column, `%${q}%`)
        .limit(limit);

      for (const row of byPhone ?? []) {
        const r = row as Record<string, unknown>;
        const rowId = String(r["id"]);
        if (seenIds.has(rowId)) continue;
        seenIds.add(rowId);
        results.push({
          id: rowId,
          display_name: (r[table.name_column] as string | null) ?? null,
          e164: table.phone_column ? (r[table.phone_column] as string | null) ?? null : null,
          table_id: table.id,
        });
      }
    }
  }

  return NextResponse.json({ contacts: results.slice(0, limit * 2) });
}
