import { NextResponse } from "next/server";
import { SipClient } from "livekit-server-sdk";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer } from "@/lib/supabase";
import { NoPhoneNumberError, pickFromNumber } from "@/lib/geo-routing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// LiveKit createSipParticipant with waitUntilAnswered=true blocks until the
// destination picks up or the ringing timeout fires (we set it to 30s). The
// Vercel function needs enough headroom to outlast it, hence 45s.
export const maxDuration = 45;

const DIAL_RATE_LIMIT = Number(process.env.DIAL_RATE_LIMIT_PER_MINUTE ?? 30);

/**
 * POST /api/desk/dial   { to_e164: string }
 *
 * Originates an outbound call from the agent's softphone. The agent must be
 * already connected to their desk LiveKit room (via /api/desk/token).
 *
 * Two call patterns, picked by env:
 *
 *   1. LiveKit outbound SIP API (preferred). When LIVEKIT_SIP_OUTBOUND_TRUNK_ID
 *      is set, we ask LiveKit to dial via Twilio (the trunk) and drop the
 *      answered PSTN leg directly into the human's `desk-<handle>` room. The
 *      human can actually talk through their softphone.
 *
 *   2. Twilio REST originate + TwiML callback (legacy fallback). When the
 *      LiveKit outbound trunk isn't configured, we POST to Twilio's
 *      /Calls.json with TwimlUrl pointing at /api/twilio-voice — the answered
 *      leg lands in whichever room the LiveKit dispatch rule chooses
 *      (typically `tel-<callsid>` with the default dispatchRuleIndividual),
 *      where an auto-dispatched AI persona picks up. The human and the
 *      destination end up in different rooms — useful for "let the IA call
 *      this number for me" but NOT for human-to-human softphone.
 *
 * Twilio still bills both paths the same way: it's the PSTN gateway in both
 * cases. Only the orchestration changes — who originates the SIP/REST call.
 *
 * Required env (path 1):
 *   LIVEKIT_URL or NEXT_PUBLIC_LIVEKIT_URL
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 *   LIVEKIT_SIP_OUTBOUND_TRUNK_ID  (set this to opt into path 1)
 *
 * Required env (path 2 fallback):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   APP_URL                        (https origin of this Next.js deployment)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { to_e164?: string };
  const to = (body.to_e164 ?? "").trim();
  if (!to || !/^\+\d{6,15}$/.test(to)) {
    return NextResponse.json({ error: "to_e164 must be E.164 (e.g. +33756123456)" }, { status: 400 });
  }

  // Authenticate the user. We then look up their human agent_handle via the
  // admin client (service-role): RLS on agent_handles has no policy today,
  // so the user-scoped session client sees zero rows even for the user's
  // own row. The user.id from auth.getUser() remains the security anchor —
  // we only ever match handles owned by that user.
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Per-user rate limit (each call costs a Twilio originate).
  const rl = rateLimit(`desk-dial:user:${user.id}`, DIAL_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      },
    );
  }

  const admin = supabaseServer();
  const { data: handle, error: handleErr } = await admin
    .from("agent_handles")
    .select("id, org_id, display_name")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (handleErr || !handle) {
    return NextResponse.json({ error: "no human agent_handle for this user" }, { status: 404 });
  }

  // DNC enforcement — reject any destination that the org has flagged.
  {
    const { data: dnc } = await admin
      .from("dnc_lists")
      .select("id, reason")
      .eq("org_id", handle.org_id)
      .eq("e164", to)
      .maybeSingle();
    if (dnc) {
      return NextResponse.json(
        {
          error:
            "Ce numéro figure sur la liste DNC (Do Not Call) de votre organisation. " +
            "Appel bloqué pour conformité TCPA." +
            (dnc.reason ? ` Motif : ${dnc.reason}` : ""),
          code: "dnc_blocked",
        },
        { status: 403 },
      );
    }
  }

  let from: string;
  try {
    const picked = await pickFromNumber(admin, handle.org_id, to);
    from = picked.e164;
  } catch (err) {
    if (err instanceof NoPhoneNumberError) {
      return NextResponse.json(
        {
          error:
            "Aucun numéro de téléphone provisionné pour cette organisation. " +
            "Achetez un numéro dans la page Numéros avant d'appeler.",
        },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : "Erreur de routage géo";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Insert a call row first so we have an id to track.
  const roomName = `desk-${handle.id}`;
  const { data: call, error: callErr } = await admin
    .from("calls")
    .insert({
      org_id: handle.org_id,
      direction: "out",
      state: "ringing",
      from_e164: from,
      to_e164: to,
      agent_handle_id: handle.id,
      room_id: roomName,
    })
    .select()
    .single();
  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });

  // ─── Path 1: LiveKit outbound SIP API ──────────────────────────────────
  //
  // When the outbound trunk is configured, LiveKit drives: it sends the
  // SIP INVITE to Twilio (the trunk), Twilio dials the PSTN destination,
  // and the answered leg is bridged into roomName ("desk-<handle>") —
  // the same room the human softphone is in. They can actually talk.
  const lkOutboundTrunkId = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID;
  const lkUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const lkApiKey = process.env.LIVEKIT_API_KEY;
  const lkApiSecret = process.env.LIVEKIT_API_SECRET;

  if (lkOutboundTrunkId && lkUrl && lkApiKey && lkApiSecret) {
    // SipClient wants the HTTPS host, not the WSS one.
    const sipHost = lkUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    const sip = new SipClient(sipHost, lkApiKey, lkApiSecret);
    try {
      const participant = await sip.createSipParticipant(
        lkOutboundTrunkId,
        to,
        roomName,
        {
          participantIdentity: `pstn-${call.id}`,
          participantName: to,
          participantAttributes: {
            "axon.call_id": call.id,
            "axon.direction": "out",
            "axon.agent_handle_id": handle.id,
            "axon.from_e164": from,
          },
          // Wait synchronously until LiveKit reports the call has been
          // answered (or failed) before returning. Without this, any
          // downstream failure (Twilio rejects the INVITE, geo block,
          // bad creds, …) happens silently in the background and the
          // dial endpoint returns 201 even though nothing ever rang.
          // Surfaces the actual SIP error in Vercel logs.
          waitUntilAnswered: true,
          // Ring timeout — fail the call if no answer within 30s rather
          // than letting LiveKit retry indefinitely.
          ringingTimeout: 30,
          // Caller-ID is chosen by LiveKit from the trunk's `numbers` list
          // (configured to `+447700162160` today). Newer SDK versions expose
          // a per-call override via `sip_number`, but it's not in the type
          // shipped with livekit-server-sdk@2.15.
        },
      );
      await admin
        .from("calls")
        .update({ metadata: { livekit_participant_sid: participant.participantId ?? null } })
        .eq("id", call.id);
      return NextResponse.json(
        { ok: true, call_id: call.id, via: "livekit", room: roomName },
        { status: 201 },
      );
    } catch (err) {
      await admin
        .from("calls")
        .update({ state: "failed", ended_at: new Date().toISOString() })
        .eq("id", call.id);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[desk-dial] LiveKit createSipParticipant failed:", msg);
      return NextResponse.json(
        { error: `LiveKit: ${msg}`, via: "livekit" },
        { status: 502 },
      );
    }
  }

  // ─── Path 2: Twilio REST + TwiML callback (legacy fallback) ────────────
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!sid || !token || !appUrl) {
    await admin
      .from("calls")
      .update({ state: "failed", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    return NextResponse.json(
      {
        error:
          "Aucun moyen d'originer l'appel : ni LIVEKIT_SIP_OUTBOUND_TRUNK_ID " +
          "(voie privilégiée), ni TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/APP_URL " +
          "(voie de repli) ne sont définis.",
      },
      { status: 500 },
    );
  }

  // The `room` + `call_id` + `direction` query params are forwarded by
  // /api/twilio-voice as SIP custom headers (X-LK-Room, X-LK-Call-Id,
  // X-LK-Direction). With dispatchRuleIndividual the destination still
  // lands in `tel-*` and the IA picks up — that's the known limitation
  // of this path. Set LIVEKIT_SIP_OUTBOUND_TRUNK_ID to take path 1
  // instead.
  const twimlUrl =
    `${appUrl.replace(/\/$/, "")}/api/twilio-voice` +
    `?room=${encodeURIComponent(roomName)}` +
    `&call_id=${encodeURIComponent(call.id)}` +
    `&direction=out`;
  const statusCb = `${appUrl.replace(/\/$/, "")}/api/twilio/status`;

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", from);
  params.set("Url", twimlUrl);
  params.set("StatusCallback", statusCb);
  params.append("StatusCallbackEvent", "initiated");
  params.append("StatusCallbackEvent", "ringing");
  params.append("StatusCallbackEvent", "answered");
  params.append("StatusCallbackEvent", "completed");
  params.set("StatusCallbackMethod", "POST");

  const twRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );
  if (!twRes.ok) {
    const errBody = await twRes.text();
    await admin.from("calls").update({ state: "failed", ended_at: new Date().toISOString() }).eq("id", call.id);
    return NextResponse.json({ error: `Twilio: ${errBody}`, via: "twilio" }, { status: 502 });
  }
  const twData = (await twRes.json()) as { sid?: string };

  await admin
    .from("calls")
    .update({ twilio_call_sid: twData.sid ?? null })
    .eq("id", call.id);

  return NextResponse.json(
    { ok: true, call_id: call.id, twilio_sid: twData.sid, via: "twilio" },
    { status: 201 },
  );
}
