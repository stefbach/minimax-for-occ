import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/twilio/queue-wait?lang=fr|en
 *
 * Twilio `<Enqueue waitUrl="…">` polls this endpoint to obtain the TwiML
 * the caller hears while waiting in the queue. Twilio loops the response
 * (Say + Play) for the duration of the wait, so the caller hears the
 * greeting alternating with the hold music until an agent picks up.
 *
 * Language is selected via the `?lang=` query param (fr default, en
 * supported). The inbound webhook passes the queue's preferred language
 * if `queues.metadata->>'lang'` is set; today the `queues` table has no
 * `metadata` column so callers always get fr.
 *
 * Env overrides:
 *   QUEUE_WAIT_GREETING_FR   French greeting text
 *   QUEUE_WAIT_GREETING_EN   English greeting text
 *   QUEUE_HOLD_MUSIC_URL     Audio URL for <Play>
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const form = new URLSearchParams(rawBody);

  if (!validateTwilioSignature(req, form)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  return buildResponse(req);
}

// Twilio also issues GET on waitUrl by default unless `waitUrlMethod="POST"`
// is set. We honour both so the endpoint is robust regardless of how it's
// wired up by callers.
export async function GET(req: Request) {
  // GET doesn't carry a signed body; still try to validate but tolerate
  // the empty-body case so dev/probe traffic isn't rejected.
  if (!validateTwilioSignature(req, "")) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }
  return buildResponse(req);
}

function buildResponse(req: Request): NextResponse {
  const url = new URL(req.url);
  const langRaw = (url.searchParams.get("lang") ?? "fr").toLowerCase();
  const lang = langRaw.startsWith("en") ? "en" : "fr";

  const greetingFr =
    process.env.QUEUE_WAIT_GREETING_FR ||
    "Un agent va vous répondre dans un instant, merci de patienter.";
  const greetingEn =
    process.env.QUEUE_WAIT_GREETING_EN ||
    "An agent will be with you shortly, please hold.";
  const musicUrl =
    process.env.QUEUE_HOLD_MUSIC_URL ||
    "https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3";

  const greeting = lang === "en" ? greetingEn : greetingFr;
  const language = lang === "en" ? "en-US" : "fr-FR";

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>` +
    `<Say voice="alice" language="${escapeXml(language)}">${escapeXml(greeting)}</Say>` +
    `<Play>${escapeXml(musicUrl)}</Play>` +
    `</Response>`;

  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
