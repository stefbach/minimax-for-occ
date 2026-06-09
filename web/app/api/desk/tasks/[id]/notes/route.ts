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
 * PATCH /api/desk/tasks/:id/notes  { notes: string }
 *
 * In-place save of free-text notes the human agent took during the call.
 * Distinct from /complete which also flips the task to 'done' and stamps
 * a disposition — the agent calls this every few seconds while they
 * type, then /complete once when they hang up.
 *
 *  - The current owner can always update their own task's notes.
 *  - Supervisors / managers / admins / owners may also write on behalf
 *    of someone else (e.g. coaching).
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

  const body = (await req.json().catch(() => null)) as { notes?: string } | null;
  const notes = typeof body?.notes === "string" ? body.notes : null;
  if (notes === null) {
    return NextResponse.json({ error: "notes required" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const { data: row, error } = await admin
    .from("human_callback_tasks")
    .select("id, assigned_to")
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
      { error: "forbidden — only the current owner or a supervisor may edit notes" },
      { status: 403 },
    );
  }

  const trimmed = notes.trim().slice(0, 10_000);
  const { error: upErr } = await admin
    .from("human_callback_tasks")
    .update({ notes: trimmed || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, task_id: id, length: trimmed.length });
}
