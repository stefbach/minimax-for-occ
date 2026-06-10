import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_QUALS = new Set([
  "RDV CONFIRME",
  "RAPPEL",
  "PAS DE REPONSE",
  "REPONDEUR",
  "PAS INTERESSE",
  "NE PAS RAPPELER",
  "FAUX NUMERO",
  "NON ELIGIBLE",
  "A PASSER A L'HUMAIN",
  "NOUVEAU DOSSIER",
]);

/**
 * POST /api/desk/manual-qualify
 *
 * After a softphone call ends, the human agent picks the qualification
 * from a dialog (PAS DE REPONSE / RAPPEL / RDV CONFIRME / …). This
 * endpoint stamps it on calls.metadata AND mirrors to leads_rdv.
 *
 * Body: { call_id, qualification, contact_id? }
 */
export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ error: "no_org" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    call_id?: string;
    qualification?: string;
    contact_id?: string | null;
  } | null;
  if (!body?.call_id || !body.qualification) {
    return NextResponse.json({ error: "call_id and qualification required" }, { status: 400 });
  }
  if (!VALID_QUALS.has(body.qualification)) {
    return NextResponse.json({ error: "invalid qualification" }, { status: 400 });
  }

  const admin = supabaseServer();

  // 1. Stamp the call.
  const { data: call } = await admin
    .from("calls")
    .select("metadata, to_e164")
    .eq("id", body.call_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!call) return NextResponse.json({ error: "call_not_found" }, { status: 404 });

  const prevMeta = (call.metadata ?? {}) as Record<string, unknown>;
  const newMeta = {
    ...prevMeta,
    qualification: body.qualification,
    qualification_source: "manual_softphone",
    qualified_at: new Date().toISOString(),
    qualified_by: auth.user.id,
  };
  const { error: upErr } = await admin
    .from("calls")
    .update({ metadata: newMeta })
    .eq("id", body.call_id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // 2. Mirror to leads_rdv-style table if it exists for this org.
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("physical_table, label")
    .eq("org_id", orgId);
  const candidate = (tables ?? []).find((t) =>
    /leads_rdv|nhs|patient/i.test(String(t.label ?? "")) ||
    /leads_rdv|nhs|patient/i.test(String(t.physical_table ?? "")),
  );
  if (candidate?.physical_table && call.to_e164) {
    for (const col of ["numero_telephone", "phone", "telephone", "e164"]) {
      const { data, error } = await admin
        .from(candidate.physical_table)
        .update({
          qualification: body.qualification,
          last_qualification_update: new Date().toISOString(),
        })
        .eq(col, call.to_e164)
        .select("id");
      if (!error && (data ?? []).length > 0) break;
      // Try without leading +
      const { data: data2 } = await admin
        .from(candidate.physical_table)
        .update({
          qualification: body.qualification,
          last_qualification_update: new Date().toISOString(),
        })
        .eq(col, call.to_e164.replace(/^\+/, ""))
        .select("id");
      if ((data2 ?? []).length > 0) break;
    }
  }

  return NextResponse.json({ ok: true });
}
