import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/data-tables/register
 *   body: { physical_table, label?, phone_column?, name_column? }
 *   Registers an ALREADY-EXISTING physical table (e.g. leads_rdv imported via
 *   the Supabase dashboard) to the caller's org, after introspecting columns.
 *
 * POST /api/data-tables/register?introspect=1
 *   body: { physical_table }
 *   Returns the table's columns so the UI can preview + let the user pick the
 *   phone/name columns BEFORE committing the registration.
 */
export async function POST(req: Request) {
  const orgId = await requestOrgId(req);
  const url = new URL(req.url);
  const introspectOnly = url.searchParams.get("introspect") === "1";

  const body = (await req.json()) as {
    physical_table?: string;
    label?: string;
    phone_column?: string;
    name_column?: string;
  };
  const physical = (body.physical_table ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(physical)) {
    return NextResponse.json({ error: "Nom de table invalide" }, { status: 400 });
  }

  const sb = supabaseServer();

  if (introspectOnly) {
    const { data, error } = await sb.rpc("rpc_introspect_table", {
      p_physical_table: physical,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const cols = (data ?? []) as Array<{ key: string; type: string }>;
    if (cols.length === 0) {
      return NextResponse.json(
        { error: `La table "${physical}" est introuvable dans ce projet Supabase.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ physical_table: physical, columns: cols });
  }

  const { data, error } = await sb.rpc("rpc_register_data_table", {
    p_org_id: orgId,
    p_physical_table: physical,
    p_label: (body.label ?? "").trim() || physical,
    p_phone_column: (body.phone_column ?? "numero_telephone").trim(),
    p_name_column: (body.name_column ?? "nom").trim() || null,
  });
  if (error) {
    const lower = error.message.toLowerCase();
    let msg = error.message;
    let status = 400;
    if (lower.includes("does not exist")) {
      msg = `La table "${physical}" n'existe pas.`;
    } else if (
      lower.includes("already registered") ||
      lower.includes("duplicate key") ||
      lower.includes("unique constraint") ||
      lower.includes("physical_table")
    ) {
      // Same org re-registering OR another org already claimed this table.
      msg = `Table "${physical}" is already connected (to your org or another). Please choose a different name.`;
      status = 409;
    }
    return NextResponse.json({ error: msg, code: status === 409 ? "name_taken" : undefined }, { status });
  }
  return NextResponse.json({ id: data, physical_table: physical }, { status: 201 });
}
