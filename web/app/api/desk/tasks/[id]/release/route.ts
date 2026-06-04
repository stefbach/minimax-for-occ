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
 * POST /api/desk/tasks/:id/release
 *
 * Unassigns a human_callback_task (back to the shared pool).
 *  - The current owner can always release their own task.
 *  - Supervisors / managers / admins / owners / super_admins may also
 *    release a task owned by someone else (e.g. agent on lunch).
 *  - Anyone else is rejected with 403.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const { data: row, error } = await admin
    .from("human_callback_tasks")
    .select("id, assigned_to, status")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const role = await currentRoleInOrg(orgId);
  const isOwner = row.assigned_to === user.id;
  const isSupervisor = role ? SUPERVISOR_ROLES.has(role) : false;
  if (!isOwner && !isSupervisor) {
    return NextResponse.json(
      { error: "forbidden — only the current owner or a supervisor may release" },
      { status: 403 },
    );
  }

  const { error: upErr } = await admin
    .from("human_callback_tasks")
    .update({
      assigned_to: null,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", orgId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, task_id: id });
}
