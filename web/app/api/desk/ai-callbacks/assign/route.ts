import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/ai-callbacks/assign
 *   body { e164, name?, scheduled_for?, user_id? }
 *
 * "Confier à un agent" depuis le calendrier IA : un humain préfère rappeler ce
 * lead lui-même plutôt que laisser Charlotte le faire. On :
 *   1. crée une human_callback_task assignée à l'agent (scheduled_for = l'heure
 *      du rappel IA), qui apparaît dans son calendrier / poste ;
 *   2. retire le lead de la file de Charlotte : qualification
 *      'A PASSER A L'HUMAIN' + rappel_rdv = null. Du coup il quitte aussi le
 *      calendrier IA (qui filtre RAPPEL + rappel_rdv) et le dialer ne le
 *      rappellera pas (qualif négative exclue + plus de date de rappel).
 *
 * user_id absent = pool partagé (tâche non assignée, à prendre par n'importe
 * quel agent).
 */
const ASSIGN_ROLES = new Set([
  "super_admin", "owner", "admin", "manager", "supervisor", "agent",
]);

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !ASSIGN_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    e164?: string;
    name?: string | null;
    scheduled_for?: string;
    user_id?: string | null;
  } | null;
  const e164 = (body?.e164 ?? "").trim();
  const assignedTo = (body?.user_id ?? "").trim() || null;
  if (!e164) return NextResponse.json({ error: "e164 requis" }, { status: 400 });

  let scheduledFor = new Date();
  if (body?.scheduled_for) {
    const ts = Date.parse(body.scheduled_for);
    if (Number.isFinite(ts)) scheduledFor = new Date(ts);
  }

  const admin = supabaseServer();

  // Validate the assignee belongs to the org (cross-tenant fence).
  if (assignedTo) {
    const { data: mem } = await admin
      .from("memberships").select("id").eq("org_id", orgId).eq("user_id", assignedTo).maybeSingle();
    if (!mem) return NextResponse.json({ error: "agent introuvable" }, { status: 404 });
  }

  // 1. Create the human callback task (assigned, scheduled at the IA time).
  const { data: task, error: taskErr } = await admin
    .from("human_callback_tasks")
    .insert({
      org_id: orgId,
      contact_id: null,
      qualification: "RAPPEL",
      transfer_reason: "Confié depuis le calendrier IA (un humain rappelle ce lead).",
      scheduled_for: scheduledFor.toISOString(),
      assigned_to: assignedTo,
      status: "pending",
      display_name: body?.name ?? null,
      e164,
    })
    .select("id")
    .maybeSingle();
  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });

  // 2. Take the lead off Charlotte's queue: negative qualification + clear the
  //    callback time so neither the callback branch nor cadence re-dials it.
  const { error: leadErr } = await admin
    .from("leads_rdv")
    .update({ qualification: "A PASSER A L'HUMAIN", rappel_rdv: null })
    .eq("numero_telephone", e164);
  if (leadErr) {
    // The task was created — report partial success so the UI still refreshes.
    return NextResponse.json({ ok: true, task_id: (task as { id?: string } | null)?.id ?? null, lead_updated: false, warn: leadErr.message });
  }

  return NextResponse.json({ ok: true, task_id: (task as { id?: string } | null)?.id ?? null, lead_updated: true });
}
