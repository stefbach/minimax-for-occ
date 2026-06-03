import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assertTeamInOrg(
  sb: ReturnType<typeof supabaseServer>,
  teamId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("agent_teams")
    .select("id")
    .eq("id", teamId)
    .eq("org_id", orgId)
    .maybeSingle();
  return !!data;
}

/** GET /api/teams/[id]/members — list members joined with agent metadata. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  // agent_team_members has no org_id column — verify the parent team belongs
  // to the caller's org first.
  if (!(await assertTeamInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "team not found" }, { status: 404 });
  }
  const { data, error } = await sb
    .from("agent_team_members")
    .select("id, agent_id, specialty, transfer_description, priority, agent:agents(id, name, description)")
    .eq("team_id", id)
    .order("priority", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** POST /api/teams/[id]/members
 * body: { agent_id, specialty?, transfer_description?, priority? }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as {
    agent_id: string;
    specialty?: string | null;
    transfer_description?: string | null;
    priority?: number;
  };
  if (!body.agent_id) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }
  if (!(await assertTeamInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "team not found" }, { status: 404 });
  }
  // Verify the agent being added belongs to the same org.
  const { data: agent } = await sb
    .from("agents")
    .select("id")
    .eq("id", body.agent_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });
  const { data, error } = await sb
    .from("agent_team_members")
    .insert({
      team_id: id,
      agent_id: body.agent_id,
      specialty: body.specialty ?? null,
      transfer_description: body.transfer_description ?? null,
      priority: body.priority ?? 1,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/** DELETE /api/teams/[id]/members?member_id=... */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const { searchParams } = new URL(req.url);
  const mid = searchParams.get("member_id");
  if (!mid) return NextResponse.json({ error: "member_id required" }, { status: 400 });
  const sb = supabaseServer();
  if (!(await assertTeamInOrg(sb, id, orgId))) {
    return NextResponse.json({ error: "team not found" }, { status: 404 });
  }
  // Scope by (member_id, team_id) so a caller can't delete a member of a
  // different team by guessing its id.
  const { error } = await sb
    .from("agent_team_members")
    .delete()
    .eq("id", mid)
    .eq("team_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
