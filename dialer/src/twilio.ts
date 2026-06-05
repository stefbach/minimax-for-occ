/**
 * Minimal Twilio REST client for outbound dialing.
 * Mirrors web/lib/twilio.ts but standalone for the worker process.
 */

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export class TwilioError extends Error {
  status: number;
  code?: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN env vars required");
  }
  return { sid, token };
}

export async function createCall(opts: {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallback?: string;
  amd?: boolean;
  timeout?: number;
  record?: boolean;
  recordingStatusCallback?: string;
}): Promise<{ sid: string; status: string }> {
  const { sid, token } = creds();
  const body = new URLSearchParams();
  body.set("To", opts.to);
  body.set("From", opts.from);
  body.set("Url", opts.twimlUrl);
  body.set("Method", "POST");
  if (opts.statusCallback) {
    body.set("StatusCallback", opts.statusCallback);
    body.set("StatusCallbackMethod", "POST");
    body.set("StatusCallbackEvent", "initiated");
    body.append("StatusCallbackEvent", "ringing");
    body.append("StatusCallbackEvent", "answered");
    body.append("StatusCallbackEvent", "completed");
  }
  if (opts.amd) body.set("MachineDetection", "DetectMessageEnd");
  if (opts.timeout !== undefined) body.set("Timeout", String(opts.timeout));
  // Twilio call recording — dual-channel (caller + agent on separate tracks
  // so we can listen to one side at a time in the dashboard). The recording
  // URL arrives on RecordingStatusCallback once the recording is processed.
  if (opts.record) {
    body.set("Record", "true");
    body.set("RecordingChannels", "dual");
    body.set("RecordingTrack", "both");
    if (opts.recordingStatusCallback) {
      body.set("RecordingStatusCallback", opts.recordingStatusCallback);
      body.set("RecordingStatusCallbackMethod", "POST");
      body.set("RecordingStatusCallbackEvent", "completed");
    }
  }

  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`${TWILIO_API_BASE}/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "content-type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave null */
  }
  if (!res.ok) {
    throw new TwilioError(json?.message ?? text ?? `Twilio HTTP ${res.status}`, res.status, json?.code);
  }
  return { sid: json.sid, status: json.status };
}
