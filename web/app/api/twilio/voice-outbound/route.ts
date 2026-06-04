import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { NoPhoneNumberError, pickFromNumber } from "@/lib/geo-routing";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/twilio/voice-outbound
 *
 * TwiML endpoint pointed at by the Twilio TwiML App that backs the
 * browser-side Twilio Voice SDK. Triggered when Twilio.Device.connect({
 * params: { To, CallerId? } }) is called from the softphone.
 *
 * Returns a <Dial> TwiML that bridges the WebRTC leg (the user's
 * browser) to the dialed PSTN number. The browser leg + the PSTN leg
 * end up in the same Twilio call — bidirectional audio, no LiveKit
 * involved on the outbound path. This is the same pattern CloudTalk,
 * Aircall and the Twilio Quickstart use for browser softphones.
 *
 * The caller-id (From) is geo-routed against the agent's org phone_numbers
 * (same logic as the legacy /api/desk/dial Twilio REST path).
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const form = new URLSearchParams(rawBody);

  if (!validateTwilioSignature(req, form)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  const to = form.get("To") ?? "";
  if (!to || !/^\+\d{6,15}$/.test(to)) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Invalid destination number.</Say><Hangup/></Response>`,
      { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } },
    );
  }

  // The TwiML app forwards every form field set when calling
  // Twilio.Device.connect({ params: {...} }), so we have access to
  // arbitrary metadata. We expect an `OrgId` param the client adds so
  // we can pick the right From number for geo-routing.
  //
  // `HumanFrom` (when set by /desk via /api/desk/caller-id) takes
  // precedence — it's the explicit "Humain" caller-ID for the org,
  // separate from the IA campaign caller-IDs. We validate it's a
  // sane E.164 to avoid a spoofing vector from the client.
  const orgId = form.get("OrgId") ?? null;
  const humanFromRaw = (form.get("HumanFrom") ?? "").trim();
  const humanFrom = /^\+\d{6,15}$/.test(humanFromRaw) ? humanFromRaw : "";

  let from = "";
  if (humanFrom) {
    from = humanFrom;
  } else if (hasSupabase() && orgId) {
    try {
      const admin = supabaseServer();
      const picked = await pickFromNumber(admin, orgId, to);
      from = picked.e164;
    } catch (err) {
      if (!(err instanceof NoPhoneNumberError)) {
        console.error("[twilio/voice-outbound] geo-routing failed:", err);
      }
      // Fall through with an empty `from` — TwiML's <Dial callerId> falls
      // back to the Twilio "Caller ID" of the originating client, which
      // for SDK-originated calls is the account's verified outbound number.
    }
  }

  // Twilio's <Dial> bridges the calling WebRTC leg into the PSTN leg.
  // answerOnBridge keeps the originating SDK leg ringing until the PSTN
  // side answers — closer to a real softphone experience.
  const callerAttr = from ? ` callerId="${escapeXml(from)}"` : "";
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true"${callerAttr}>
    <Number>${escapeXml(to)}</Number>
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
