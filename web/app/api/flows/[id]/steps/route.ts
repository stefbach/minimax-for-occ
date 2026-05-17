import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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

  const { data, error } = await sb
    .from("flow_steps")
    .update(patch)
    .eq("id", body.id)
    .eq("flow_id", flowId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
