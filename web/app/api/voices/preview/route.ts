import { NextResponse } from "next/server";
import { previewTTS } from "@/lib/minimax";
import { requestOrgId } from "@/lib/request-org";
import { recordUsage, estimateCostCents } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/voices/preview  body: { voice_id, text?, speed?, emotion? }
 * Returns audio/mpeg bytes the browser can play directly.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    voice_id?: string;
    text?: string;
    speed?: number;
    emotion?: string;
    model?: string;
  };
  if (!body.voice_id) {
    return NextResponse.json({ error: "voice_id required" }, { status: 400 });
  }
  try {
    const text =
      body.text || "Bonjour, je suis votre nouvel assistant vocal. Comment puis-je vous aider ?";
    const { audio, format } = await previewTTS({
      voice_id: body.voice_id,
      text,
      speed: body.speed,
      emotion: body.emotion,
      model: body.model,
    });

    // Billing: record TTS chars (best-effort, never blocks the response).
    try {
      const orgId = await requestOrgId(req);
      const chars = text.length;
      if (chars > 0) {
        await recordUsage(
          orgId,
          "tts_chars",
          chars,
          estimateCostCents("tts_chars", chars),
          { voice_id: body.voice_id, model: body.model ?? null },
        );
      }
    } catch {
      /* never block playback on billing failures */
    }

    return new Response(audio, {
      status: 200,
      headers: {
        "content-type": format,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
