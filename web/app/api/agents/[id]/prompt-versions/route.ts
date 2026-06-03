import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agents/[id]/prompt-versions — full history (newest first). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  // Verify the parent agent belongs to this org before exposing the
  // version history (prompt_versions has no org_id column — inherits via
  // agent_id).
  const { data: agent } = await sb
    .from("agents")
    .select("id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });
  const { data, error } = await sb
    .from("prompt_versions")
    .select("*")
    .eq("agent_id", id)
    .order("version", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** POST /api/agents/[id]/prompt-versions
 * Snapshots the agent's current (system_prompt, greeting) into a new version.
 * Optionally accepts { system_prompt, greeting, note } in the body so the UI
 * can save a draft as a version without first persisting to agents.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json().catch(() => ({}))) as {
    system_prompt?: string;
    greeting?: string | null;
    note?: string | null;
  };

  // Pull current agent values as the fallback source-of-truth.
  const { data: agent, error: agentErr } = await sb
    .from("agents")
    .select("system_prompt, greeting, org_id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  const systemPrompt = body.system_prompt ?? (agent.system_prompt as string | null) ?? "";
  const greeting = body.greeting ?? (agent.greeting as string | null) ?? null;

  // Next version = max(existing) + 1. prompt_versions inherits tenancy
  // via agent_id (no org_id column); parent agent is already org-checked.
  const { data: last } = await sb
    .from("prompt_versions")
    .select("version")
    .eq("agent_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((last?.version as number | undefined) ?? 0) + 1;

  const { data, error } = await sb
    .from("prompt_versions")
    .insert({
      agent_id: id,
      version: nextVersion,
      system_prompt: systemPrompt,
      greeting,
      note: body.note ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
