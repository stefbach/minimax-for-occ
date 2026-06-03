import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/teams/[id] — team + ordered list of members (with agent meta). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: team, error: teamErr } = await sb
    .from("agent_teams")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });
  if (!team) return NextResponse.json({ error: "not found" }, { status: 404 });

  // agent_team_members inherits tenancy via team_id; parent team is checked above.
  const { data: members, error: memErr } = await sb
    .from("agent_team_members")
    .select("id, agent_id, specialty, transfer_description, priority, agent:agents(id, name, description)")
    .eq("team_id", id)
    .order("priority", { ascending: true });
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  return NextResponse.json({ ...team, members: members ?? [] });
}

/** PATCH /api/teams/[id] — update mutable fields. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "description", "lead_agent_id"]) {
    if (k in body) patch[k] = body[k];
  }
  const { data, error } = await sb
    .from("agent_teams")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

/** DELETE /api/teams/[id] — cascade removes members via FK. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { error } = await sb
    .from("agent_teams")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
