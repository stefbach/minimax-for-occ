import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio Voice webhook -> TwiML that bridges the call into a LiveKit SIP trunk.
 *
 * Two call patterns share this endpoint:
 *
 * 1. Inbound — caller dials a Twilio number whose webhook points here. The
 *    URL has no query string, so the call lands in whatever room the LiveKit
 *    SIP dispatch rule chooses (e.g. `tel-<callsid>` with `dispatchRuleIndividual`).
 *    An auto-dispatched agent IA worker picks up and talks.
 *
 * 2. Outbound from /api/desk/dial — a human softphone originates the call.
 *    /desk/dial calls Twilio with TwimlUrl = ".../api/twilio-voice?room=desk-{handle}&call_id={id}&agent_handle_id={id}".
 *    We forward those values into the SIP URI as Twilio custom params (the
 *    `X-` prefix means Twilio relays them as SIP headers on the INVITE), so
 *    the LiveKit dispatch rule can route the call to the human's existing
 *    desk room instead of creating a fresh `tel-*` one.
 *
 *    The LiveKit-side enablement is documented in agent/sip/README.md:
 *    update the dispatch rule to consume the `X-LK-Room` header (e.g. via
 *    `lk sip dispatch-rule update`) or, cleaner, refactor /desk/dial to call
 *    LiveKit's outbound SIP API directly.
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

  // Read the routing metadata /api/desk/dial appends to the TwimlUrl. Inbound
  // calls won't have any of these — that's fine, we omit them and let the
  // dispatch rule fall back to its default behavior (auto-named room + IA).
  const url = new URL(req.url);
  const room = url.searchParams.get("room");
  const callId = url.searchParams.get("call_id");
  const agentHandleId = url.searchParams.get("agent_handle_id");
  const direction = url.searchParams.get("direction");

  const auth =
    process.env.LIVEKIT_SIP_USERNAME && process.env.LIVEKIT_SIP_PASSWORD
      ? ` username="${escapeXml(process.env.LIVEKIT_SIP_USERNAME)}" password="${escapeXml(process.env.LIVEKIT_SIP_PASSWORD)}"`
      : "";

  // Build the SIP URI parameters. Names prefixed with `X-` get relayed as
  // SIP custom headers on the INVITE by Twilio, which LiveKit's dispatch
  // rule can then read (either to route to a specific room, or just to
  // expose them as participant attributes).
  const sipParams = new URLSearchParams({ from, to });
  if (room) sipParams.set("X-LK-Room", room);
  if (callId) sipParams.set("X-LK-Call-Id", callId);
  if (agentHandleId) sipParams.set("X-LK-Agent-Handle-Id", agentHandleId);
  if (direction) sipParams.set("X-LK-Direction", direction);

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
