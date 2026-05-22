import { NextResponse } from "next/server";
import { validateTelnyxSignature } from "@/lib/telnyx-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telnyx Voice webhook → TeXML that bridges the call into a LiveKit SIP trunk.
 *
 * This is the TeXML equivalent of /api/twilio-voice. The structure is
 * nearly identical — Telnyx's TeXML dialect accepts the same verbs.
 *
 * Two call patterns share this endpoint:
 *
 * 1. Inbound — caller dials a Telnyx number whose TeXML App points here.
 *    No query string → call lands in the LiveKit dispatch rule (AI agent picks up).
 *
 * 2. Outbound from /api/desk/dial — human softphone originates the call.
 *    The URL carries ?room=desk-{handle}&call_id={id}&direction=out
 *    Those params become SIP X-* headers so LiveKit routes to the agent's room.
 *
 * Configure in Telnyx portal:
 *   Voice → TeXML Applications → New → Voice Handler URL: https://your-app/api/telnyx-voice
 *   Then assign your phone number to this TeXML Application.
 *
 * Required env:
 *   LIVEKIT_SIP_URI          e.g. sip:your-project.sip.livekit.cloud
 *   LIVEKIT_SIP_USERNAME     (optional) trunk auth username
 *   LIVEKIT_SIP_PASSWORD     (optional) trunk auth password
 *   TELNYX_WEBHOOK_SECRET    from Telnyx portal → Webhooks → Signing Secret
 */
export async function POST(req: Request) {
  const sipUri = process.env.LIVEKIT_SIP_URI;
  if (!sipUri) {
    return new NextResponse("LIVEKIT_SIP_URI missing", { status: 500 });
  }

  const rawBody = await req.text().catch(() => "");
  if (!(await validateTelnyxSignature(req, rawBody))) {
    return new NextResponse("invalid telnyx signature", { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";

  const url = new URL(req.url);
  const room = url.searchParams.get("room");
  const callId = url.searchParams.get("call_id");
  const agentHandleId = url.searchParams.get("agent_handle_id");
  const direction = url.searchParams.get("direction");

  const auth =
    process.env.LIVEKIT_SIP_USERNAME && process.env.LIVEKIT_SIP_PASSWORD
      ? ` username="${escapeXml(process.env.LIVEKIT_SIP_USERNAME)}" password="${escapeXml(process.env.LIVEKIT_SIP_PASSWORD)}"`
      : "";

  const sipParams = new URLSearchParams({ from, to });
  if (room) sipParams.set("X-LK-Room", room);
  if (callId) sipParams.set("X-LK-Call-Id", callId);
  if (agentHandleId) sipParams.set("X-LK-Agent-Handle-Id", agentHandleId);
  if (direction) sipParams.set("X-LK-Direction", direction);

  const target = `${sipUri}?${sipParams.toString()}`;

  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true">
    <Sip${auth}>${escapeXml(target)}</Sip>
  </Dial>
</Response>`;

  return new NextResponse(texml, {
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
