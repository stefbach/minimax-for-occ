import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/desk/patient-note/[contact_id]
 *
 * Updates the `note` column on the patient's leads table row, looked up
 * by the contact's E.164 number. Wati June 10: the PatientDrawer's
 * note textarea posts here so an agent can save free-text observations
 * during or after a call.
 *
 * Body: { note: string }
 * Returns: { ok: true } on success; { ok: false, reason } when no leads
 * table is registered for the org or no row matches.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ contact_id: string }> },
) {
  if (!hasSupabase()) return NextResponse.json({ ok: false, reason: "supabase_unavailable" }, { status: 503 });
  const sbSession = await supabaseSession();
  const { data: auth } = await sbSession.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { contact_id } = await ctx.params;
  if (!contact_id) return NextResponse.json({ error: "contact_id required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { note?: string } | null;
  if (typeof body?.note !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }

  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ ok: false, reason: "no_org" }, { status: 400 });

  const admin = supabaseServer();

  // 1. Resolve contact's phone number.
  const { data: contact } = await admin
    .from("contacts")
    .select("e164")
    .eq("id", contact_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!contact?.e164) {
    return NextResponse.json({ ok: false, reason: "contact_not_found_or_no_phone" }, { status: 200 });
  }

  // 2. Find org's primary leads table (matches /leads_rdv|nhs|patient/i first).
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("physical_table, label")
    .eq("org_id", orgId);
  const candidate = (tables ?? []).find((t) =>
    /leads_rdv|nhs|patient/i.test(String(t.label ?? "")) ||
    /leads_rdv|nhs|patient/i.test(String(t.physical_table ?? "")),
  );
  if (!candidate?.physical_table) {
    return NextResponse.json({ ok: false, reason: "no_leads_table_registered" }, { status: 200 });
  }
  const table = candidate.physical_table;

  // 3. Find the row by phone. Try common phone-column names.
  const phoneCols = ["numero_telephone", "phone", "telephone", "e164"];
  let updated = 0;
  for (const col of phoneCols) {
    const { data, error } = await admin
      .from(table)
      .update({ note: body.note, last_updated: new Date().toISOString() })
      .eq(col, contact.e164)
      .select("id");
    if (!error && (data ?? []).length > 0) {
      updated = data.length;
      break;
    }
    // Some leads tables strip the leading + on the phone column.
    if (!error) {
      const stripped = contact.e164.replace(/^\+/, "");
      const { data: data2 } = await admin
        .from(table)
        .update({ note: body.note, last_updated: new Date().toISOString() })
        .eq(col, stripped)
        .select("id");
      const arr = data2 ?? [];
      if (arr.length > 0) {
        updated = arr.length;
        break;
      }
    }
  }

  if (updated === 0) {
    return NextResponse.json({ ok: false, reason: "no_row_for_phone", table, e164: contact.e164 }, { status: 200 });
  }
  return NextResponse.json({ ok: true, table, updated });
}
