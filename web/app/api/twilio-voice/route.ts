import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio Voice webhook -> TwiML that bridges the call into a LiveKit SIP trunk.
 *
 * Configure on a Twilio phone number (Voice & Fax -> "A call comes in"):
 *   Webhook: https://your-app.vercel.app/api/twilio-voice  (HTTP POST)
 *
 * Required env:
 *   LIVEKIT_SIP_URI        e.g. sip:your-project.sip.livekit.cloud
 *   LIVEKIT_SIP_USERNAME   (optional) trunk auth username
 *   LIVEKIT_SIP_PASSWORD   (optional) trunk auth password
 *   TWILIO_AUTH_TOKEN      used to validate X-Twilio-Signature on every call
 */
export async function POST(req: Request) {
  const sipUri = process.env.LIVEKIT_SIP_URI;
  if (!sipUri) {
    return new NextResponse("LIVEKIT_SIP_URI missing", { status: 500 });
  }

  // Read the body once as text so we can both validate the Twilio signature
  // and parse the form fields below.
  const rawBody = await req.text().catch(() => "");
  const params = new URLSearchParams(rawBody);
  if (!validateTwilioSignature(req, params)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";

  const auth =
    process.env.LIVEKIT_SIP_USERNAME && process.env.LIVEKIT_SIP_PASSWORD
      ? ` username="${escapeXml(process.env.LIVEKIT_SIP_USERNAME)}" password="${escapeXml(process.env.LIVEKIT_SIP_PASSWORD)}"`
      : "";

  // Pass caller metadata to LiveKit via SIP URI params; the dispatch rule can
  // forward them as participant attributes for the agent.
  const sipParams = new URLSearchParams({ from, to });
  const target = `${sipUri}?${sipParams.toString()}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true">
    <Sip${auth}>${escapeXml(target)}</Sip>
  </Dial>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
