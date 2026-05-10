import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb.from("agents").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
    "system_prompt",
    "greeting",
    "rag_enabled",
    "rag_top_k",
    "metadata",
  ]) {
    if (k in body) patch[k] = body[k];
  }
  const { data, error } = await sb
    .from("agents")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { error } = await sb.from("agents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
