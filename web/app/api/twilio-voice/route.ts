import { NextResponse } from "next/server";

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
 */
export async function POST(req: Request) {
  const sipUri = process.env.LIVEKIT_SIP_URI;
  if (!sipUri) {
    return new NextResponse("LIVEKIT_SIP_URI missing", { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  const from = form?.get("From")?.toString() ?? "";
  const to = form?.get("To")?.toString() ?? "";

  const auth =
    process.env.LIVEKIT_SIP_USERNAME && process.env.LIVEKIT_SIP_PASSWORD
      ? ` username="${escapeXml(process.env.LIVEKIT_SIP_USERNAME)}" password="${escapeXml(process.env.LIVEKIT_SIP_PASSWORD)}"`
      : "";

  // Pass caller metadata to LiveKit via SIP URI params; the dispatch rule can
  // forward them as participant attributes for the agent.
  const params = new URLSearchParams({ from, to });
  const target = `${sipUri}?${params.toString()}`;

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
