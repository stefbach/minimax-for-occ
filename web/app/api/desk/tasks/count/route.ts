import { NextResponse } from "next/server";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight task counts for the sidebar badge.
 *
 * Returns just the PERSONAL queue count (tasks assigned to me, all dates,
 * pending+in_progress). Wati June 10 v3: the badge used to include the
 * shared pool, which is now managed by Supervision — keeping the pool
 * count on Mon poste was confusing because it showed 12 even when the
 * agent had nothing in their own queue.
 *
 * Kept separate from /api/desk/tasks so we can poll on a short interval
 * from the sidebar without taxing the DB. ~2 ms / query.
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

  const admin = supabaseServer();

  const { count: personal } = await admin
    .from("human_callback_tasks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("assigned_to", user.id)
    .in("status", ["pending", "in_progress"]);

  return NextResponse.json({
    personal: personal ?? 0,
    shared: 0,
    total: personal ?? 0,
  });
}
