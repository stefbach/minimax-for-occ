import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTwilioRecordingUrl } from "@/lib/twilio-recording";
import { transcribeAudioBuffer } from "@/lib/assemblyai-transcribe";
import type { RainAiReview } from "@/app/api/dashboard/rain-call-detail/route";

// Shared by the single-call analysis route (rain-call-analysis) and the
// end-of-day report route (rain-daily-report) — both need to turn a call
// recording into a cached AI review on calls.metadata.rain_ai_review.

const DEEPSEEK_CHAT_URL =
  (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "") +
  "/chat/completions";

export class RainAnalysisError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function generateReview(transcript: string): Promise<{ summary: string; critique: string; rating: RainAiReview["rating"] }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new RainAnalysisError("config", "DEEPSEEK_API_KEY missing");

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
  if (!res.ok) throw new RainAnalysisError("deepseek", `DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
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

type CallRow = {
  id: string;
  recording_url: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Ensures calls.metadata.rain_ai_review exists for the given call. Returns
 * the cached review if already present, otherwise downloads the recording,
 * transcribes it, and generates the review — persisting it back.
 * Throws RainAnalysisError on any failure (no_recording / transcription /
 * analysis) so callers can decide how to surface it (single vs bulk).
 */
export async function ensureCallAnalysis(
  sb: SupabaseClient,
  call: CallRow,
): Promise<RainAiReview> {
  const meta = (call.metadata ?? {}) as Record<string, unknown>;

  if (meta.rain_ai_review) {
    return meta.rain_ai_review as RainAiReview;
  }

  let recordingUrl = call.recording_url;
  if (!recordingUrl && typeof meta.twilio_call_sid === "string" && meta.twilio_call_sid) {
    recordingUrl = await fetchTwilioRecordingUrl(meta.twilio_call_sid);
  }
  if (!recordingUrl) {
    throw new RainAnalysisError("no_recording", "Aucun enregistrement disponible pour cet appel.");
  }

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
    throw new RainAnalysisError("audio_fetch_failed", e instanceof Error ? e.message : String(e));
  }

  let transcriptText: string;
  try {
    const result = await transcribeAudioBuffer(audioBuf, { language: "en", speakerLabels: true });
    transcriptText = result.utterances?.length
      ? result.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
      : result.text;
  } catch (e) {
    throw new RainAnalysisError("transcription_failed", e instanceof Error ? e.message : String(e));
  }

  if (!transcriptText.trim()) {
    throw new RainAnalysisError("empty_transcript", "La transcription est vide (appel silencieux ou trop court).");
  }

  const review = await generateReview(transcriptText);

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
    .eq("id", call.id);

  return aiReview;
}

export type DailySynthesis = {
  overall_verdict: string;
  strengths: string;
  improvements: string;
};

/** One extra DeepSeek call that reads every per-call summary+critique for
 * the day and produces a short overall assessment — strengths, points to
 * improve, and a one-line verdict for the manager. */
export async function synthesizeDailyReport(
  reviews: Array<{ nom: string | null; review: RainAiReview }>,
): Promise<DailySynthesis> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new RainAnalysisError("config", "DEEPSEEK_API_KEY missing");

  const system = [
    "Tu es superviseur qualité pour un centre d'appel médical. On te donne les analyses individuelles",
    "de tous les appels passés aujourd'hui par Rain, une coordinatrice humaine.",
    "Réponds UNIQUEMENT en JSON valide avec exactement ces clés (en français) :",
    "overall_verdict (1-2 phrases : verdict global de la journée),",
    "strengths (2-4 phrases : points forts observés sur l'ensemble des appels),",
    "improvements (2-4 phrases : points à améliorer, concrets et actionnables).",
  ].join(" ");

  const listing = reviews
    .map((r, i) => `Appel ${i + 1} — ${r.nom ?? "Patient"} (note: ${r.review.rating ?? "n/a"})\nRésumé: ${r.review.summary}\nCritique: ${r.review.critique}`)
    .join("\n\n");

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: listing },
      ],
    }),
  });
  if (!res.ok) throw new RainAnalysisError("deepseek", `DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: Partial<DailySynthesis> = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return {
    overall_verdict: parsed.overall_verdict ?? "Synthèse indisponible.",
    strengths: parsed.strengths ?? "—",
    improvements: parsed.improvements ?? "—",
  };
}
