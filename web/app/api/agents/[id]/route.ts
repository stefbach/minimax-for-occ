import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agents")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as Record<string, unknown>;
  // Whitelist mutable fields.
  const patch: Record<string, unknown> = {};
  for (const k of [
    "name",
    "description",
    "language",
    "llm_provider",
    "llm_model",
    "tts_voice_id",
    "tts_emotion",
    "tts_speed",
    "tts_volume",
    "tts_pitch",
    "tts_model",
    "tts_stability",
    "tts_similarity_boost",
    "tts_style",
    "tts_speaker_boost",
    "tts_language",
    "tts_english_normalization",
    "voice_style",
    "system_prompt",
    "greeting",
    "rag_enabled",
    "rag_top_k",
    "metadata",
  ]) {
    if (k in body) patch[k] = body[k];
  }
  // A MiniMax voice without an explicit model gets speech-02-hd (the only
  // model whose voice catalog matches our UI presets like Casual_Guy).
  if (patch.tts_voice_id && !patch.tts_model) {
    const { data: current } = await sb
      .from("agents")
      .select("tts_model")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();
    if (!current?.tts_model) patch.tts_model = "speech-02-hd";
  }
  const { data, error } = await sb
    .from("agents")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { error } = await sb
    .from("agents")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
