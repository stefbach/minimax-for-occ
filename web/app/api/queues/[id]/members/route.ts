import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assertQueueInOrg(
  sb: ReturnType<typeof supabaseServer>,
  queueId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("queues")
    .select("id")
    .eq("id", queueId)
    .eq("org_id", orgId)
    .maybeSingle();
  return !!data;
}

/** GET /api/queues/[id]/members — list members joined with agent_handles. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  // queue_memberships has no org_id column — verify the parent queue belongs
  // to the caller's org before exposing its members.
  if (!(await assertQueueInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "queue not found" }, { status: 404 });
  }
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
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as { agent_handle_id: string; priority?: number };
  if (!body.agent_handle_id) {
    return NextResponse.json({ error: "agent_handle_id required" }, { status: 400 });
  }
  if (!(await assertQueueInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "queue not found" }, { status: 404 });
  }
  // Verify the target agent_handle is also in this org.
  const { data: handle } = await sb
    .from("agent_handles")
    .select("id")
    .eq("id", body.agent_handle_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!handle) return NextResponse.json({ error: "agent_handle not found" }, { status: 404 });
  const { data, error } = await sb
    .from("queue_memberships")
    .insert({ queue_id: id, agent_handle_id: body.agent_handle_id, priority: body.priority ?? 1 })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/** DELETE /api/queues/[id]/members?membership_id= */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const { searchParams } = new URL(req.url);
  const mid = searchParams.get("membership_id");
  if (!mid) return NextResponse.json({ error: "membership_id required" }, { status: 400 });
  const sb = supabaseServer();
  if (!(await assertQueueInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "queue not found" }, { status: 404 });
  }
  // Scope the delete to (membership_id, queue_id) so a caller can't delete
  // a membership from another queue by guessing its id.
  const { error } = await sb
    .from("queue_memberships")
    .delete()
    .eq("id", mid)
    .eq("queue_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
