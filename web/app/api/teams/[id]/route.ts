import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/teams/[id] — team + ordered list of members (with agent meta). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data: team, error: teamErr } = await sb
    .from("agent_teams")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });
  if (!team) return NextResponse.json({ error: "not found" }, { status: 404 });

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
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** DELETE /api/teams/[id] — cascade removes members via FK. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { error } = await sb.from("agent_teams").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
