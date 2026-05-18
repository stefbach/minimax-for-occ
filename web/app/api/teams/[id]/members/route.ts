import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/teams/[id]/members — list members joined with agent metadata. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
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
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const mid = searchParams.get("member_id");
  if (!mid) return NextResponse.json({ error: "member_id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("agent_team_members").delete().eq("id", mid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
