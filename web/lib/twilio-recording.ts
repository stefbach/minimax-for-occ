// Fetch the recording URL for a Twilio call by CallSid.
//
// Trunk-level recording records every call automatically but Twilio doesn't
// post a Recording Status Callback for it (the callback URL field doesn't
// exist on the trunk config UI). The recording is reachable only via the
// REST API:
//   GET /2010-04-01/Accounts/{Account}/Calls/{CallSid}/Recordings.json
//
// We hit this lazily when the dashboard player asks for a call that has no
// recording_url stored yet, then persist the URL so subsequent loads skip
// the API call. Returns null on any failure — the caller falls back to the
// "no_recording" path.

const TWILIO_API = "https://api.twilio.com";

export async function fetchTwilioRecordingUrl(callSid: string): Promise<string | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return null;

  const url = `${TWILIO_API}/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  let body: { recordings?: Array<{ uri?: string; sid?: string }> } | null = null;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      // Twilio's API is fast (<500ms typically) — cap to 5s so a slow
      // upstream doesn't hang the dashboard player.
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    body = await r.json();
  } catch {
    return null;
  }

  const rec = body?.recordings?.[0];
  if (!rec?.sid) return null;

  // The Recordings API returns a `uri` like
  //   /2010-04-01/Accounts/AC.../Recordings/RE....json
  // We want the playable audio URL — same SID without the .json suffix and
  // with .mp3. The /Recordings/{SID}.mp3 endpoint is publicly streamable
  // (Basic Auth still required) and returns audio/mpeg.
  return `${TWILIO_API}/2010-04-01/Accounts/${accountSid}/Recordings/${rec.sid}.mp3`;
}

function authHeader(): string | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

// Fallback for Axon/LiveKit calls whose row never got a twilio_call_sid stamped
// (the LiveKit leg and the Twilio leg landed on separate rows). We find the
// Twilio call by number + start time, then resolve its recording. Returns
// { url, sid } so the caller can persist the sid for next time.
export async function findTwilioRecordingForCall(args: {
  to: string | null;
  from: string | null;
  startedAtMs: number;
}): Promise<{ url: string; sid: string } | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = authHeader();
  if (!accountSid || !auth || !Number.isFinite(args.startedAtMs)) return null;
  if (!args.to && !args.from) return null;

  const dayIso = new Date(args.startedAtMs).toISOString().slice(0, 10);
  const qs = new URLSearchParams({ "StartTime>": dayIso, PageSize: "100" });
  if (args.to) qs.set("To", args.to); else if (args.from) qs.set("From", args.from);
  const listUrl = `${TWILIO_API}/2010-04-01/Accounts/${accountSid}/Calls.json?${qs.toString()}`;

  let calls: Array<{ sid?: string; start_time?: string }> = [];
  try {
    const r = await fetch(listUrl, { headers: { Authorization: auth }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { calls?: Array<{ sid?: string; start_time?: string }> };
    calls = j.calls ?? [];
  } catch {
    return null;
  }

  // Pick the Twilio call whose start_time is closest to ours (within 5 min).
  let best: { sid: string; diff: number } | null = null;
  for (const c of calls) {
    if (!c.sid || !c.start_time) continue;
    const diff = Math.abs(Date.parse(c.start_time) - args.startedAtMs);
    if (!Number.isFinite(diff) || diff > 5 * 60_000) continue;
    if (!best || diff < best.diff) best = { sid: c.sid, diff };
  }
  if (!best) return null;

  const recUrl = await fetchTwilioRecordingUrl(best.sid);
  return recUrl ? { url: recUrl, sid: best.sid } : null;
}
