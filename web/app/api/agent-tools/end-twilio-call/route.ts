import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent-tools/end-twilio-call
 *
 * Called by the LiveKit agent worker the moment its hygiene watchdog
 * decides to hang up. Without this, SIP BYE propagation from LK Cloud to
 * Twilio adds 8-12 seconds of dead silence on the patient's side — the
 * agent has already disconnected but Twilio doesn't tear down the PSTN
 * leg until the BYE arrives.
 *
 * We can't call Twilio directly from the agent because the agent process
 * doesn't carry TWILIO_ACCOUNT_SID/AUTH_TOKEN — those live on Vercel (and
 * on the dialer's Fly app, but the agent runs separately on LK Cloud).
 * Proxying here keeps Twilio creds in exactly one tier.
 *
 * Authenticated with the same INTERNAL_AGENT_API_TOKEN bearer used by
 * /api/agent-tools/transfer-to-human.
 *
 * Body: { call_sid: string }
 * Returns: { ok: true, status_code: 200 } on Twilio success, or the
 *          Twilio HTTP status + body excerpt on failure.
 */
export async function POST(req: Request) {
  const expected = process.env.INTERNAL_AGENT_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_AGENT_API_TOKEN not set on the server" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m || m[1] !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { call_sid?: string } | null;
  const callSid = body?.call_sid?.trim();
  if (!callSid || !/^CA[0-9a-f]{32}$/i.test(callSid)) {
    return NextResponse.json(
      { ok: false, error: "call_sid must be a Twilio CA-prefixed 34-char SID" },
      { status: 400 },
    );
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioSid || !twilioToken) {
    return NextResponse.json(
      { ok: false, error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set" },
      { status: 500 },
    );
  }

  const auth = "Basic " + Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${callSid}.json`;
  let twilioStatus = 0;
  let twilioBody = "";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: auth,
        "content-type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ Status: "completed" }).toString(),
      // Cap upstream latency so a slow Twilio doesn't keep the agent
      // hanging — the agent is already doing its LK disconnect in parallel.
      signal: AbortSignal.timeout(4000),
    });
    twilioStatus = r.status;
    twilioBody = (await r.text().catch(() => "")).slice(0, 300);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }

  if (twilioStatus >= 400) {
    return NextResponse.json(
      { ok: false, status_code: twilioStatus, body: twilioBody },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, status_code: twilioStatus });
}
