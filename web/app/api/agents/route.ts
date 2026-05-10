import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import type { AgentInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agents")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const sb = supabaseServer();
  const body = (await req.json()) as AgentInput;
  if (!body.name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("agents")
    .insert({
      name: body.name,
      description: body.description ?? null,
      language: body.language ?? "multi",
      llm_provider: body.llm_provider ?? "openai",
      llm_model: body.llm_model ?? "gpt-4o",
      tts_voice_id: body.tts_voice_id ?? null,
      tts_emotion: body.tts_emotion ?? null,
      tts_speed: body.tts_speed ?? 1.0,
      system_prompt: body.system_prompt ?? "",
      greeting: body.greeting ?? "Bonjour, je vous écoute.",
      rag_enabled: body.rag_enabled ?? false,
      rag_top_k: body.rag_top_k ?? 4,
      metadata: body.metadata ?? {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
