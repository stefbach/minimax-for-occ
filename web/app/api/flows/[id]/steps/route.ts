import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEP_KINDS = [
  "welcome",
  "menu_dtmf",
  "gather_speech",
  "ai_agent",
  "transfer",
  "route_queue",
  "voicemail",
  "hangup",
] as const;
type StepKind = (typeof STEP_KINDS)[number];

async function assertFlowInOrg(
  sb: ReturnType<typeof supabaseServer>,
  flowId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("org_id", orgId)
    .maybeSingle();
  return !!data;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as {
    kind?: string;
    label?: string;
    config?: Record<string, unknown>;
    position?: Record<string, unknown>;
  };
  if (!body.kind || !STEP_KINDS.includes(body.kind as StepKind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  // flow_steps inherit tenancy via flow_id (no org_id column); verify the
  // parent flow belongs to this org before letting the caller attach steps.
  if (!(await assertFlowInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "flow not found" }, { status: 404 });
  }
  const { data, error } = await sb
    .from("flow_steps")
    .insert({
      flow_id: id,
      kind: body.kind,
      label: body.label ?? null,
      config: body.config ?? {},
      position: body.position ?? {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: flowId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as {
    id?: string;
    label?: string;
    config?: Record<string, unknown>;
    position?: Record<string, unknown>;
    kind?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) patch.label = body.label;
  if (body.config !== undefined) patch.config = body.config;
  if (body.position !== undefined) patch.position = body.position;
  if (body.kind !== undefined) {
    if (!STEP_KINDS.includes(body.kind as StepKind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }
    patch.kind = body.kind;
  }

  if (!(await assertFlowInOrg(sb, flowId, orgId))) {
    return NextResponse.json({ error: "flow not found" }, { status: 404 });
  }

  const { data, error } = await sb
    .from("flow_steps")
    .update(patch)
    .eq("id", body.id)
    .eq("flow_id", flowId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
