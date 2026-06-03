import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/data-tables/assignable
 *
 * Tables a super-admin has ASSIGNED to the caller's org that aren't yet
 * CONNECTED (registered in tenant_data_tables). These populate the
 * "Connecter une table existante" dropdown so the client never types a raw
 * table name and can only ever see their own assigned tables.
 */
export async function GET(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  const [{ data: assigned }, { data: registered }] = await Promise.all([
    sb
      .from("assignable_data_tables")
      .select("physical_table, note")
      .eq("org_id", orgId),
    sb
      .from("tenant_data_tables")
      .select("physical_table")
      .eq("org_id", orgId),
  ]);

  const already = new Set((registered ?? []).map((r) => (r as { physical_table: string }).physical_table));
  const available = (assigned ?? [])
    .map((a) => a as { physical_table: string; note: string | null })
    .filter((a) => !already.has(a.physical_table));

  return NextResponse.json(available);
}
