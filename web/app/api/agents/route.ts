import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import type { AgentInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as AgentInput;
  if (!body.name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("agents")
    .insert({
      org_id: orgId,
      name: body.name,
      description: body.description ?? null,
      language: body.language ?? "multi",
      llm_provider: body.llm_provider ?? "deepseek",
      llm_model: body.llm_model ?? "deepseek-v4-flash",
      tts_voice_id: body.tts_voice_id ?? null,
      tts_emotion: body.tts_emotion ?? null,
      tts_speed: body.tts_speed ?? 1.0,
      tts_model: body.tts_model || (body.tts_voice_id ? "speech-02-hd" : null),
      system_prompt: body.system_prompt ?? "",
      greeting: body.greeting ?? "Bonjour, je vous écoute.",
      rag_enabled: body.rag_enabled ?? false,
      rag_top_k: body.rag_top_k ?? 4,
      metadata: body.metadata ?? {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Every AI agent needs a matching agent_handle (kind='ai') — that's what
  // campaigns, queues and call routing select from. Without this the agent
  // is invisible to the rest of the platform. Create it here so the UI flow
  // (which only POSTs to /api/agents) stays one step.
  const { error: handleErr } = await sb
    .from("agent_handles")
    .insert({
      org_id: orgId,
      kind: "ai",
      ai_agent_id: data.id,
      display_name: data.name,
    });
  if (handleErr) {
    // Don't fail the whole creation — the agent row exists. Surface in logs;
    // a backfill can reconcile. But log loudly since it breaks campaign use.
    console.error("[agents] agent created but handle insert failed:", handleErr.message);
  }

  return NextResponse.json(data, { status: 201 });
}
