import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

/**
 * GET  /api/automations          → list this org's native workflows + recent runs
 * POST /api/automations          → create a workflow { name, description?, trigger, steps, active? }
 *
 * Native Axon automations (the mini-n8n). Secrets never transit here — steps
 * reference org_credentials by id; credentials are managed via
 * /api/automations/credentials.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ workflows: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);

  const admin = supabaseServer();
  const { data: wfs, error } = await admin
    .from("org_workflows")
    .select("id, name, description, active, trigger, steps, last_run_at, last_status, created_at, agent_id, approval_mode, group_label, sort_order")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve management-agent names for the cards.
  const agentIds = Array.from(
    new Set((wfs ?? []).map((w) => w.agent_id).filter(Boolean)),
  ) as string[];
  const agentNames: Record<string, string> = {};
  if (agentIds.length > 0) {
    const { data: ags } = await admin.from("agents").select("id, name").in("id", agentIds);
    for (const a of ags ?? []) agentNames[a.id as string] = a.name as string;
  }

  const ids = (wfs ?? []).map((w) => w.id);
  let runs: unknown[] = [];
  if (ids.length > 0) {
    const { data: r } = await admin
      .from("org_workflow_runs")
      .select("id, workflow_id, started_at, finished_at, status, matched, actions, skipped, errors")
      .in("workflow_id", ids)
      .order("started_at", { ascending: false })
      .limit(50);
    runs = r ?? [];
  }
  const decorated = (wfs ?? []).map((w) => ({
    ...w,
    agent_name: w.agent_id ? agentNames[w.agent_id as string] ?? null : null,
  }));
  return NextResponse.json({ workflows: decorated, runs });
}

export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    trigger?: unknown;
    steps?: unknown;
    active?: boolean;
    agent_id?: string | null;
    approval_mode?: string | null;
  } | null;
  if (!body?.name || !body.trigger || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "name, trigger, steps required" }, { status: 400 });
  }

  const admin = supabaseServer();

  // If a management agent is bound, verify it belongs to this org and is a
  // management agent (telephony agents must not drive workflows).
  let agentId: string | null = null;
  if (body.agent_id) {
    const { data: ag } = await admin
      .from("agents")
      .select("id, purpose")
      .eq("id", body.agent_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!ag) return NextResponse.json({ error: "agent introuvable" }, { status: 400 });
    if ((ag as { purpose?: string }).purpose !== "management") {
      return NextResponse.json({ error: "l'agent lié doit être un agent de gestion" }, { status: 400 });
    }
    agentId = ag.id as string;
  }

  const approvalMode = body.approval_mode === "review" ? "review" : "auto";

  const { data, error } = await admin
    .from("org_workflows")
    .insert({
      org_id: orgId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      trigger: body.trigger,
      steps: body.steps,
      active: body.active ?? false,
      agent_id: agentId,
      approval_mode: approvalMode,
    })
    .select("id, name, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
