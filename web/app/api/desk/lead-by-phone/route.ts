import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/lead-by-phone?e164=+447700123456
 * → { found, contact_id?, display_name?, note? }
 *
 * POST /api/desk/lead-by-phone
 * Body: { e164, nom, email?, note? }
 * → { contact_id, display_name }
 *
 * Powers the softphone CallNotePanel — looks up an existing lead by
 * phone, or creates a new contact + leads_rdv row if none exists.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ found: false });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ found: false });
  const e164 = new URL(req.url).searchParams.get("e164")?.trim();
  if (!e164 || !/^\+\d{6,15}$/.test(e164)) {
    return NextResponse.json({ error: "valid e164 required" }, { status: 400 });
  }

  const admin = supabaseServer();
  const { data: contact } = await admin
    .from("contacts")
    .select("id, display_name")
    .eq("org_id", orgId)
    .eq("e164", e164)
    .maybeSingle();
  if (!contact) return NextResponse.json({ found: false });

  // Try to grab the note from the leads_rdv-style table.
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("physical_table, label")
    .eq("org_id", orgId);
  const candidate = (tables ?? []).find((t) =>
    /leads_rdv|nhs|patient/i.test(String(t.label ?? "")) ||
    /leads_rdv|nhs|patient/i.test(String(t.physical_table ?? "")),
  );
  let note: string | null = null;
  if (candidate?.physical_table) {
    for (const col of ["numero_telephone", "phone", "telephone", "e164"]) {
      const { data: row, error } = await admin
        .from(candidate.physical_table)
        .select("note")
        .eq(col, e164)
        .maybeSingle();
      if (!error && row && "note" in row) {
        note = (row as { note?: string | null }).note ?? null;
        break;
      }
      // also try without leading +
      const { data: row2 } = await admin
        .from(candidate.physical_table)
        .select("note")
        .eq(col, e164.replace(/^\+/, ""))
        .maybeSingle();
      if (row2 && "note" in row2) {
        note = (row2 as { note?: string | null }).note ?? null;
        break;
      }
    }
  }

  return NextResponse.json({
    found: true,
    contact_id: contact.id,
    display_name: contact.display_name,
    note,
  });
}

export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ error: "no_org" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    e164?: string;
    nom?: string;
    email?: string;
    note?: string;
  } | null;
  if (!body?.e164 || !/^\+\d{6,15}$/.test(body.e164)) {
    return NextResponse.json({ error: "valid e164 required" }, { status: 400 });
  }
  if (!body.nom?.trim()) {
    return NextResponse.json({ error: "nom required" }, { status: 400 });
  }

  const admin = supabaseServer();

  // 1. Ensure a contact exists.
  const { data: existing } = await admin
    .from("contacts")
    .select("id, display_name")
    .eq("org_id", orgId)
    .eq("e164", body.e164)
    .maybeSingle();
  let contactId = existing?.id ?? null;
  if (!contactId) {
    const { data: created, error: cErr } = await admin
      .from("contacts")
      .insert({ org_id: orgId, e164: body.e164, display_name: body.nom.trim() })
      .select("id")
      .single();
    if (cErr || !created) {
      return NextResponse.json({ error: cErr?.message ?? "create contact failed" }, { status: 500 });
    }
    contactId = created.id;
  }

  // 2. Try to seed a row in the leads_rdv-style table so the lead lives in
  //    the same place as the prospection batches.
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("physical_table, label")
    .eq("org_id", orgId);
  const candidate = (tables ?? []).find((t) =>
    /leads_rdv|nhs|patient/i.test(String(t.label ?? "")) ||
    /leads_rdv|nhs|patient/i.test(String(t.physical_table ?? "")),
  );
  if (candidate?.physical_table) {
    // Best-effort insert: try common column names; ignore errors so a
    // missing column doesn't fail the whole call. The phone column varies
    // across tenants (numero_telephone vs phone vs e164).
    const candidatesPhoneCol = ["numero_telephone", "phone", "telephone", "e164"];
    for (const col of candidatesPhoneCol) {
      const payload: Record<string, unknown> = {
        [col]: body.e164,
        nom: body.nom.trim(),
      };
      if (body.email) payload.email = body.email;
      if (body.note) payload.note = body.note;
      payload.source_lead = "softphone_manual";
      const { error } = await admin.from(candidate.physical_table).insert(payload);
      if (!error) break;
      // If insert failed because the column is missing, try the next
      // candidate. Other errors (unique violation etc.) we silently drop —
      // the contact row above is the source of truth for the softphone.
    }
  }

  return NextResponse.json({
    contact_id: contactId,
    display_name: body.nom.trim(),
  });
}
