import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { runWorkflowAndRecord, type WorkflowRow } from "@/lib/automations/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

/**
 * POST /api/automations/:id/run — manual "Run now" from the UI. Useful to
 * test a workflow before activating it, or to drain a backlog without
 * waiting for the next cron tick. Runs even when active=false.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const { id } = await params;
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();
  const { data: wf, error } = await admin
    .from("org_workflows")
    .select("id, org_id, name, active, trigger, steps, last_run_at, agent_id, approval_mode")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!wf) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const stats = await runWorkflowAndRecord(wf as unknown as WorkflowRow);
  return NextResponse.json({
    ok: stats.errors === 0,
    matched: stats.matched,
    actions: stats.actions,
    skipped: stats.skipped,
    errors: stats.errors,
    log: stats.log.slice(-30),
  });
}
