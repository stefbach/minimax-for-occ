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

  // Verify the target belongs to this org (unless it's null = unassign).
  if (target) {
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
    .select("id, assigned_to, status")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

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

  return NextResponse.json({ ok: true, task_id: id });
}
