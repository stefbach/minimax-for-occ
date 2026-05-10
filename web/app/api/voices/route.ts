import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { registerVoiceClone, uploadVoiceCloneSample } from "@/lib/minimax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("voices")
    .select("*")
    .order("source", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

const VOICE_ID_RE = /^[A-Za-z][A-Za-z0-9_]{7,63}$/;

/**
 * POST /api/voices  (multipart/form-data)
 *   file:           audio sample (wav/mp3/m4a, 10s–5min, ≤20MB, single speaker)
 *   voice_id:       8–64 chars, [A-Za-z][A-Za-z0-9_]+
 *   display_name:   human label
 *   language:       'multi' | 'fr' | 'en' | ...
 *   description?:   optional notes
 *   sample_text?:   default text used for previews
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const voiceId = String(form.get("voice_id") ?? "").trim();
  const displayName = String(form.get("display_name") ?? "").trim();
  const language = String(form.get("language") ?? "multi").trim() || "multi";
  const description = (form.get("description") as string | null)?.toString() || null;
  const sampleText = (form.get("sample_text") as string | null)?.toString() || undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }
  if (!VOICE_ID_RE.test(voiceId)) {
    return NextResponse.json(
      { error: "voice_id must be 8–64 chars, start with a letter, [A-Za-z0-9_] only" },
      { status: 400 },
    );
  }
  if (!displayName) {
    return NextResponse.json({ error: "display_name required" }, { status: 400 });
  }
  if (file.size === 0 || file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "file too small/large (max 20MB)" }, { status: 400 });
  }

  // 1. upload sample to MiniMax, 2. register clone
  let fileId: string;
  try {
    const up = await uploadVoiceCloneSample(file);
    fileId = up.file_id;
    await registerVoiceClone({ file_id: fileId, voice_id: voiceId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // 3. record in Supabase so the dropdown picks it up
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("voices")
    .upsert(
      {
        voice_id: voiceId,
        display_name: displayName,
        language,
        source: "cloned",
        description,
        sample_text: sampleText ?? undefined,
        metadata: { minimax_file_id: fileId, original_filename: file.name },
      },
      { onConflict: "voice_id" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("voices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
