import { NextResponse } from "next/server";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight task counts for the sidebar badge.
 *
 * Returns:
 *   personal: tasks assigned to me, pending/in_progress, scheduled today
 *   shared:   unassigned pending tasks scheduled today
 *
 * Kept separate from /api/desk/tasks (which joins contacts + counts calls)
 * so we can poll it on a short interval from the sidebar without taxing
 * the DB. ~2 ms / query.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ personal: 0, shared: 0, total: 0 });
  }
  const sbSession = await supabaseSession();
  const { data: auth } = await sbSession.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orgId = await requestOrgId(req);
  if (!orgId) {
    return NextResponse.json({ personal: 0, shared: 0, total: 0 });
  }

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  const admin = supabaseServer();

  const [{ count: personal }, { count: shared }] = await Promise.all([
    admin
      .from("human_callback_tasks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("assigned_to", user.id)
      .in("status", ["pending", "in_progress"])
      .gte("scheduled_for", dayStart)
      .lt("scheduled_for", dayEnd),
    admin
      .from("human_callback_tasks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("assigned_to", null)
      .eq("status", "pending")
      .gte("scheduled_for", dayStart)
      .lt("scheduled_for", dayEnd),
  ]);

  return NextResponse.json({
    personal: personal ?? 0,
    shared: shared ?? 0,
    total: (personal ?? 0) + (shared ?? 0),
  });
}
