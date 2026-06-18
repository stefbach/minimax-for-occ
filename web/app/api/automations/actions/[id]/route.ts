import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { executeQueuedAction } from "@/lib/automations/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

/**
 * POST /api/automations/actions/[id]  { decision: "approve" | "reject" }
 *
 * Approve → send the AI-drafted email/WhatsApp (or apply the row update) via
 * the engine's executor, mark the row, flip status to 'sent'. Reject → status
 * 'rejected'. Manager+ only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { decision?: string } | null;
  const decision = body?.decision;

  const admin = supabaseServer();
  // Ownership + state check.
  const { data: action } = await admin
    .from("org_workflow_actions")
    .select("id, status")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!action) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ((action.status as string) !== "pending") {
    return NextResponse.json({ error: `action déjà ${action.status}` }, { status: 409 });
  }

  if (decision === "reject") {
    const { error } = await admin
      .from("org_workflow_actions")
      .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: auth.user.id })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  if (decision === "approve") {
    const out = await executeQueuedAction(orgId, id);
    if (!out.ok) return NextResponse.json({ error: out.error ?? "envoi échoué" }, { status: 400 });
    // Record who approved (status already flipped to 'sent' by the executor).
    await admin.from("org_workflow_actions").update({ decided_by: auth.user.id }).eq("id", id);
    return NextResponse.json({ ok: true, status: "sent" });
  }

  return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
}
