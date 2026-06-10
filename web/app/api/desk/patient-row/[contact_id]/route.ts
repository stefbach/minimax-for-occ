import { NextResponse } from "next/server";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/desk/patient-row/[contact_id]
 *   → { table_label, physical_table, row_id, row, columns }
 *
 * PATCH /api/desk/patient-row/[contact_id]
 *   Body: { values: { <column>: <value>, ... } }
 *   → { ok: true, row }
 *
 * Full editable patient row from the org's primary leads table — what
 * the CRM data-table edit modal shows, but addressed by contact_id.
 * Used by the PatientDrawer (Wati June 10 v4: 'il manque tous les
 * details comme dans crm/contact').
 */

interface ColumnSpec {
  key: string;
  label: string;
  type: string;
}

async function resolveTable(orgId: string) {
  const admin = supabaseServer();
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("id, label, physical_table, columns")
    .eq("org_id", orgId);
  const candidate = (tables ?? []).find((t) =>
    /leads_rdv|nhs|patient/i.test(String(t.label ?? "")) ||
    /leads_rdv|nhs|patient/i.test(String(t.physical_table ?? "")),
  );
  return candidate as
    | { id: string; label: string; physical_table: string; columns: ColumnSpec[] | null }
    | undefined;
}

async function lookupRow(admin: ReturnType<typeof supabaseServer>, table: string, e164: string) {
  for (const col of ["numero_telephone", "phone", "telephone", "e164"]) {
    const { data, error } = await admin.from(table).select("*").eq(col, e164).maybeSingle();
    if (!error && data) return data;
    const { data: data2 } = await admin
      .from(table)
      .select("*")
      .eq(col, e164.replace(/^\+/, ""))
      .maybeSingle();
    if (data2) return data2;
  }
  return null;
}

export async function GET(req: Request, ctx: { params: Promise<{ contact_id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ error: "no_org" }, { status: 400 });
  const { contact_id } = await ctx.params;
  if (!contact_id) return NextResponse.json({ error: "contact_id required" }, { status: 400 });

  const admin = supabaseServer();
  const { data: contact } = await admin
    .from("contacts")
    .select("e164")
    .eq("id", contact_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!contact?.e164) {
    return NextResponse.json({ row: null, columns: [], table_label: null, physical_table: null, row_id: null });
  }

  const table = await resolveTable(orgId);
  if (!table) {
    return NextResponse.json({ row: null, columns: [], table_label: null, physical_table: null, row_id: null });
  }
  const row = await lookupRow(admin, table.physical_table, contact.e164);

  return NextResponse.json({
    table_label: table.label,
    physical_table: table.physical_table,
    row_id: (row as { id?: string } | null)?.id ?? null,
    row: row ?? null,
    columns: table.columns ?? [],
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ contact_id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ error: "no_org" }, { status: 400 });
  const { contact_id } = await ctx.params;
  if (!contact_id) return NextResponse.json({ error: "contact_id required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
  const values = body?.values ?? {};
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: "values required" }, { status: 400 });
  }

  const admin = supabaseServer();
  const { data: contact } = await admin
    .from("contacts")
    .select("e164")
    .eq("id", contact_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!contact?.e164) {
    return NextResponse.json({ error: "contact_not_found_or_no_phone" }, { status: 404 });
  }

  const table = await resolveTable(orgId);
  if (!table) {
    return NextResponse.json({ error: "no_leads_table_registered" }, { status: 404 });
  }

  // Strip undefined and forbidden columns.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k === "id" || k === "created_at") continue;
    if (v === "" || v === null || v === undefined) {
      patch[k] = null;
    } else {
      patch[k] = v;
    }
  }
  patch.last_qualification_update = new Date().toISOString();

  for (const col of ["numero_telephone", "phone", "telephone", "e164"]) {
    const { data: row, error } = await admin
      .from(table.physical_table)
      .update(patch)
      .eq(col, contact.e164)
      .select("*")
      .maybeSingle();
    if (!error && row) return NextResponse.json({ ok: true, row });
    const { data: row2 } = await admin
      .from(table.physical_table)
      .update(patch)
      .eq(col, contact.e164.replace(/^\+/, ""))
      .select("*")
      .maybeSingle();
    if (row2) return NextResponse.json({ ok: true, row: row2 });
  }

  return NextResponse.json({ error: "row_not_found" }, { status: 404 });
}
