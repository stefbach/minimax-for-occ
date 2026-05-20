import { NextResponse } from "next/server";
import { previewTTS } from "@/lib/minimax";
import { requestOrgId } from "@/lib/request-org";
import { recordUsage, estimateCostCents } from "@/lib/billing";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VOICES_PREVIEW_RATE_LIMIT = Number(
  process.env.VOICES_PREVIEW_RATE_LIMIT_PER_MINUTE ?? 20,
);

/**
 * POST /api/voices/preview  body: { voice_id, text?, speed?, emotion? }
 * Returns audio/mpeg bytes the browser can play directly.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`voices-preview:ip:${ip}`, VOICES_PREVIEW_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      },
    );
  }

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
