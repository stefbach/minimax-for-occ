import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { NoPhoneNumberError, pickFromNumber } from "@/lib/geo-routing";
import { resolveOutboundFrom } from "@/lib/outbound-numbers";
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
  // Twilio.Device.connect({ params: {...} }). `OrgId` + `HumanFrom` are
  // client-set hints. The AUTHORITATIVE signal is the SDK identity in the
  // `From` field ("client:user-<uuid>", see /api/desk/twilio-token): we
  // resolve the caller-ID from it so the per-agent restriction can't be
  // bypassed by tampering with HumanFrom.
  const orgIdParam = form.get("OrgId") ?? null;
  const humanFromRaw = (form.get("HumanFrom") ?? "").trim();
  const humanFrom = /^\+\d{6,15}$/.test(humanFromRaw) ? humanFromRaw : "";
  const clientId = form.get("From") ?? form.get("Caller") ?? "";
  const idMatch = clientId.match(/^client:user-([0-9a-fA-F-]{36})/);
  const callerUserId = idMatch ? idMatch[1] : null;

  let from = "";
  if (hasSupabase()) {
    const admin = supabaseServer();
    try {
      if (callerUserId) {
        // Authoritative path: org from the agent's human handle, then restrict
        // to their assigned numbers (HumanFrom is their pick — validated
        // inside resolveOutboundFrom; an unassigned number is ignored). No
        // assignment → org default geo-routing.
        const { data: handle } = await admin
          .from("agent_handles")
          .select("org_id")
          .eq("kind", "human")
          .eq("user_id", callerUserId)
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        const orgId = (handle?.org_id as string | undefined) ?? orgIdParam;
        if (orgId) {
          const resolved = await resolveOutboundFrom(admin, orgId, callerUserId, to, humanFrom);
          from = resolved.e164;
        } else if (humanFrom) {
          from = humanFrom;
        }
      } else if (humanFrom) {
        // Couldn't identify the agent — trust the validated HumanFrom.
        from = humanFrom;
      } else if (orgIdParam) {
        const picked = await pickFromNumber(admin, orgIdParam, to);
        from = picked.e164;
      }
    } catch (err) {
      if (!(err instanceof NoPhoneNumberError)) {
        console.error("[twilio/voice-outbound] caller-ID resolution failed:", err);
      }
      // Best-effort fallback so the call still goes out.
      if (!from && humanFrom) from = humanFrom;
    }
  } else if (humanFrom) {
    from = humanFrom;
  }

  // Twilio's <Dial> bridges the calling WebRTC leg into the PSTN leg.
  // answerOnBridge keeps the originating SDK leg ringing until the PSTN
  // side answers — closer to a real softphone experience.
  //
  // record="record-from-answer-dual" captures both legs (agent + patient) as
  // separate tracks from the moment the PSTN side picks up. Twilio POSTs the
  // finished recording to recordingStatusCallback (the existing
  // /api/twilio/recording-status webhook, shared with the AI dialer) — it
  // resolves the calls row by top-level twilio_call_sid = the Dial's parent
  // CallSid, which Softphone.tsx stamps on `accept` via call.parameters.CallSid.
  const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const recordingCbAttr = appUrl
    ? ` recordingStatusCallback="${escapeXml(`${appUrl}/api/twilio/recording-status`)}" recordingStatusCallbackEvent="completed"`
    : "";
  const callerAttr = from ? ` callerId="${escapeXml(from)}"` : "";
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" record="record-from-answer-dual"${recordingCbAttr}${callerAttr}>
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
