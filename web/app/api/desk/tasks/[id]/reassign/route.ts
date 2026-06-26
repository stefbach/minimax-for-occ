import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/**
 * PATCH /api/desk/tasks/:id/reassign  { assigned_to: uuid | null }
 *
 * Manual reassignment by a supervisor/manager. The target user must be
 * a member of the same org (or null = back to the shared pool).
 *  - If the task was unassigned (null → user), status flips to
 *    'in_progress'.
 *  - Otherwise the current status is preserved (e.g. a paused
 *    'in_progress' stays 'in_progress').
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    assigned_to?: string | null;
  } | null;
  // body.assigned_to of null is a legitimate value (send back to pool).
  if (!body || !("assigned_to" in body)) {
    return NextResponse.json({ error: "assigned_to required" }, { status: 400 });
  }
  const target = body.assigned_to;
  // Sentinel: "__AI__" hands the lead back to the AI dialer (not a real user).
  const isAI = target === "__AI__";

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = supabaseServer();

  // Verify the target belongs to this org (unless it's null = unassign, or the
  // "__AI__" sentinel = hand the lead back to the AI dialer).
  if (target && !isAI) {
    const { data: m, error: mErr } = await admin
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", target)
      .maybeSingle();
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    if (!m) {
      return NextResponse.json(
        { error: "target user is not a member of this org" },
        { status: 400 },
      );
    }
  }

  const { data: row, error } = await admin
    .from("human_callback_tasks")
    .select("id, assigned_to, status, e164, contact_id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // "Agent IA": close the human task and reactivate the lead so the dialer
  // re-includes it (Wati 25/06). cycle_status→ACTIF + qualification→RAPPEL
  // (callback now) makes dynamic selection pick it up at the next slot.
  if (isAI) {
    const { error: aiErr } = await admin
      .from("human_callback_tasks")
      .update({ assigned_to: null, status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", orgId);
    if (aiErr) return NextResponse.json({ error: aiErr.message }, { status: 500 });
    await reactivateLeadForAI(
      admin,
      orgId,
      (row as { e164?: string | null }).e164 ?? null,
      (row as { contact_id?: string | null }).contact_id ?? null,
    );
    return NextResponse.json({ ok: true, task_id: id, handed_to: "ai" });
  }

  const patch: Record<string, unknown> = {
    assigned_to: target,
    updated_at: new Date().toISOString(),
  };
  // null → user: bump status to in_progress. Other transitions keep the
  // current status (we never auto-mark something 'done' from a reassign).
  if (row.assigned_to == null && target) {
    patch.status = "in_progress";
  } else if (target == null) {
    // user → null: send back to pool, ensure status is 'pending'.
    if (row.status === "in_progress") patch.status = "pending";
  }

  const { error: upErr } = await admin
    .from("human_callback_tasks")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Sync assigned_to → leads_rdv.agent so all pages stay coherent.
  const phone = (row as { e164?: string | null }).e164 ?? null;
  if (phone) {
    try {
      await admin.from("leads_rdv" as never).update({ agent: target ?? null })
        .eq("numero_telephone", phone);
    } catch { /* non-fatal — tenant may not have leads_rdv */ }
  }

  return NextResponse.json({ ok: true, task_id: id });
}

/**
 * Hand a lead back to the AI dialer: set the lead row ACTIF + RAPPEL (callback
 * now) so dynamic selection re-includes it at the next slot. Best-effort —
 * resolves the org's dynamic data table + column mapping from a campaign
 * engine; no-op if it can't resolve (e.g. a non-dynamic tenant). Never throws.
 */
async function reactivateLeadForAI(
  admin: ReturnType<typeof supabaseServer>,
  orgId: string,
  e164: string | null,
  contactId: string | null,
): Promise<void> {
  try {
    let phone = e164;
    if (!phone && contactId) {
      const { data: c } = await admin
        .from("contacts").select("e164").eq("id", contactId).maybeSingle();
      phone = (c as { e164?: string | null } | null)?.e164 ?? null;
    }
    if (!phone) return;
    const { data: camps } = await admin
      .from("campaigns")
      .select("data_table_id, metadata, state")
      .eq("org_id", orgId);
    type Camp = {
      data_table_id: string | null;
      metadata: { engine?: Record<string, unknown> } | null;
      state: string | null;
    };
    const list = (camps ?? []) as Camp[];
    const hasEngine = (c: Camp) => !!c.metadata?.engine && !!c.data_table_id;
    const camp = list.find((c) => c.state === "running" && hasEngine(c)) ?? list.find(hasEngine);
    if (!camp) return;
    const engine = camp.metadata!.engine as {
      selection?: { status_column?: string };
      callback?: { datetime_column?: string };
    };
    const statusCol = engine.selection?.status_column ?? "qualification";
    const cbCol = engine.callback?.datetime_column ?? null;
    const { data: reg } = await admin
      .from("tenant_data_tables")
      .select("physical_table, phone_column")
      .eq("id", camp.data_table_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!reg) return;
    const table = (reg as { physical_table: string }).physical_table;
    const phoneCol = (reg as { phone_column: string | null }).phone_column || "numero_telephone";
    const upd: Record<string, unknown> = { cycle_status: "ACTIF", [statusCol]: "RAPPEL" };
    if (cbCol) upd[cbCol] = new Date().toISOString();
    await admin.from(table).update(upd).eq(phoneCol, phone);
  } catch (e) {
    console.error("reactivateLeadForAI failed", e);
  }
}
