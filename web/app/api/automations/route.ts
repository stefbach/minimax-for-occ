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
    .select("id, name, description, active, trigger, steps, last_run_at, last_status, created_at, group_label, sort_order")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
  return NextResponse.json({ workflows: wfs ?? [], runs });
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
  } | null;
  if (!body?.name || !body.trigger || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "name, trigger, steps required" }, { status: 400 });
  }

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("org_workflows")
    .insert({
      org_id: orgId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      trigger: body.trigger,
      steps: body.steps,
      active: body.active ?? false,
    })
    .select("id, name, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
