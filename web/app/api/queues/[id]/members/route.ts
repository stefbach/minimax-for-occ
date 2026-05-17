import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/queues/[id]/members — list members joined with agent_handles. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("queue_memberships")
    .select("id, priority, agent_handle:agent_handles(id, kind, display_name, ai_agent_id, user_id, active)")
    .eq("queue_id", id)
    .order("priority", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** POST /api/queues/[id]/members — body { agent_handle_id, priority? } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const body = (await req.json()) as { agent_handle_id: string; priority?: number };
  if (!body.agent_handle_id) {
    return NextResponse.json({ error: "agent_handle_id required" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("queue_memberships")
    .insert({ queue_id: id, agent_handle_id: body.agent_handle_id, priority: body.priority ?? 1 })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/** DELETE /api/queues/[id]/members?membership_id= */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const mid = searchParams.get("membership_id");
  if (!mid) return NextResponse.json({ error: "membership_id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("queue_memberships").delete().eq("id", mid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
