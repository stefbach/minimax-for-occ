import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";
import { fetchTwilioRecordingUrl } from "@/lib/twilio-recording";
import { transcribeAudioBuffer } from "@/lib/assemblyai-transcribe";
import type { RainAiReview } from "../rain-call-detail/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEEPSEEK_CHAT_URL =
  (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "") +
  "/chat/completions";

async function generateReview(transcript: string): Promise<{ summary: string; critique: string; rating: RainAiReview["rating"] }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY missing");

  const system = [
    "Tu es superviseur qualité pour un centre d'appel médical (chirurgie bariatrique).",
    "Analyse la transcription d'un appel passé par Rain, une coordinatrice humaine, à un patient.",
    "Réponds UNIQUEMENT en JSON valide avec exactement ces clés : summary (résumé factuel de l'appel en 2-4 phrases, en français), ",
    "critique (analyse critique de la prestation de Rain : a-t-elle bien parlé, bien expliqué, été professionnelle et empathique, ",
    "a-t-elle répondu aux questions du patient, y a-t-il un point à améliorer ? 2-5 phrases en français), ",
    "rating (une seule valeur parmi \"bon\", \"moyen\", \"insuffisant\").",
  ].join(" ");

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Transcription (speaker labels A/B, A/B ne correspondent pas forcément à Rain vs patient) :\n\n${transcript}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: { summary?: string; critique?: string; rating?: string } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  const rating = parsed.rating === "bon" || parsed.rating === "moyen" || parsed.rating === "insuffisant" ? parsed.rating : null;
  return {
    summary: parsed.summary ?? "Résumé indisponible.",
    critique: parsed.critique ?? "Analyse indisponible.",
    rating,
  };
}

export async function POST(req: Request) {
  await requestOrgId(req);
  const sb = supabaseServer();

  const body = (await req.json().catch(() => ({}))) as { call_id?: string };
  const callId = body.call_id;
  if (!callId) return NextResponse.json({ error: "call_id required" }, { status: 400 });

  const { data: call, error } = await sb
    .from("calls")
    .select("id, recording_url, metadata")
    .eq("id", callId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });

  const meta = (call.metadata ?? {}) as Record<string, unknown>;

  // Already analysed? Return the cached review.
  if (meta.rain_ai_review) {
    return NextResponse.json({ ok: true, ai_review: meta.rain_ai_review as RainAiReview, cached: true });
  }

  // 1. Resolve the recording URL (lazy backfill from Twilio if needed).
  let recordingUrl = call.recording_url;
  if (!recordingUrl && typeof meta.twilio_call_sid === "string" && meta.twilio_call_sid) {
    recordingUrl = await fetchTwilioRecordingUrl(meta.twilio_call_sid);
  }
  if (!recordingUrl) {
    return NextResponse.json({ error: "no_recording", message: "Aucun enregistrement disponible pour cet appel." }, { status: 404 });
  }

  // 2. Download the audio bytes ourselves (Twilio needs Basic Auth).
  const upstreamHeaders: Record<string, string> = {};
  if (recordingUrl.startsWith("https://api.twilio.com/") && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const tok = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    upstreamHeaders["Authorization"] = `Basic ${tok}`;
  }
  let audioBuf: Buffer;
  try {
    const audioRes = await fetch(recordingUrl, { headers: upstreamHeaders });
    if (!audioRes.ok) throw new Error(`audio fetch HTTP ${audioRes.status}`);
    audioBuf = Buffer.from(await audioRes.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "audio_fetch_failed", message: msg }, { status: 502 });
  }

  // 3. Transcribe via AssemblyAI (same vendor as the AI voice agent).
  let transcriptText: string;
  try {
    const result = await transcribeAudioBuffer(audioBuf, { language: "en", speakerLabels: true });
    if (result.utterances?.length) {
      transcriptText = result.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n");
    } else {
      transcriptText = result.text;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "transcription_failed", message: msg }, { status: 502 });
  }

  if (!transcriptText.trim()) {
    return NextResponse.json({ error: "empty_transcript", message: "La transcription est vide (appel silencieux ou trop court)." }, { status: 422 });
  }

  // 4. Generate the summary + critical review via DeepSeek.
  let review: { summary: string; critique: string; rating: RainAiReview["rating"] };
  try {
    review = await generateReview(transcriptText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "analysis_failed", message: msg }, { status: 502 });
  }

  const aiReview: RainAiReview = {
    transcript: transcriptText,
    summary: review.summary,
    critique: review.critique,
    rating: review.rating,
    generated_at: new Date().toISOString(),
  };

  await sb
    .from("calls")
    .update({ recording_url: recordingUrl, metadata: { ...meta, rain_ai_review: aiReview } })
    .eq("id", callId);

  return NextResponse.json({ ok: true, ai_review: aiReview, cached: false });
}
