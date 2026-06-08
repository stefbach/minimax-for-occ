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
