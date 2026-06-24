import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assign / unassign a patient (lead) to a coordinator queue — writes to the
// legacy dashboard_assignments table through axon_assign_lead() /
// axon_unassign_lead(), so the Summer / Rain / Stormi queues stay in sync
// across both dashboards.

export async function POST(request: Request) {
  await requestOrgId(request); // auth context — dashboard is behind login
  let body: { lead_id?: string; phone?: string; name?: string; assigned_to?: string; unassign?: boolean; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if ((!body.lead_id && !body.phone && !body.name) || (!body.assigned_to && !body.unassign)) {
    return NextResponse.json({ error: "lead_id (ou phone ou name) et assigned_to (ou unassign) requis" }, { status: 400 });
  }
  const legacy = nhsLegacyClient();
  let leadId = body.lead_id ?? null;
  // The calls drill only knows the phone number — resolve the lead there.
  if (!leadId && body.phone) {
    const { data } = await legacy
      .from("leads_rdv")
      .select("id")
      .eq("numero_telephone", body.phone)
      .limit(1)
      .maybeSingle();
    leadId = (data as { id: string } | null)?.id ?? null;
    if (!leadId) {
      return NextResponse.json({ error: "Aucun lead avec ce numéro" }, { status: 404 });
    }
  }
  // The static NHS_REPORT views only know the patient name — resolve the lead
  // through nhs_dossiers (which carries the canonical lead_id), exact match
  // first then a first-word + last-word fuzzy match.
  if (!leadId && body.name) {
    const name = body.name.trim();
    const { data: exact } = await legacy
      .from("nhs_dossiers")
      .select("lead_id")
      .ilike("nom", name)
      .not("lead_id", "is", null)
      .limit(1)
      .maybeSingle();
    leadId = (exact as { lead_id: string } | null)?.lead_id ?? null;
    if (!leadId) {
      const parts = name.split(/\s+/);
      const first = parts[0];
      const last = parts[parts.length - 1];
      const { data: fuzzy } = await legacy
        .from("nhs_dossiers")
        .select("lead_id")
        .ilike("nom", `%${first}%`)
        .ilike("nom", `%${last}%`)
        .not("lead_id", "is", null)
        .limit(1)
        .maybeSingle();
      leadId = (fuzzy as { lead_id: string } | null)?.lead_id ?? null;
    }
    if (!leadId) {
      return NextResponse.json({ error: "Aucun dossier pour ce patient" }, { status: 404 });
    }
  }
  if (body.unassign) {
    const { error } = await legacy.rpc("axon_unassign_lead", { p_lead_id: leadId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { error } = await legacy.rpc("axon_assign_lead", {
    p_lead_id: leadId,
    p_assigned_to: body.assigned_to,
    p_reason: body.reason ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
