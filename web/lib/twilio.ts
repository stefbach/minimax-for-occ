/**
 * Server-side helper for the Twilio REST API.
 *
 * Reads credentials from env vars:
 *   TWILIO_ACCOUNT_SID  — starts with "AC..."
 *   TWILIO_AUTH_TOKEN   — auth token from Twilio Console
 *
 * All requests hit https://api.twilio.com/2010-04-01/Accounts/{sid}/...
 * with HTTP Basic auth (sid:token).
 */

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface TwilioAvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  isoCountry: string;
  locality: string | null;
  region: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
}

export interface TwilioIncomingNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string | null;
  smsUrl: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
}

export class TwilioConfigError extends Error {
  constructor() {
    super(
      "Twilio non configuré : définissez TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN dans les variables d'environnement Vercel.",
    );
    this.name = "TwilioConfigError";
  }
}

export class TwilioApiError extends Error {
  status: number;
  twilioCode?: number;
  constructor(message: string, status: number, twilioCode?: number) {
    super(message);
    this.name = "TwilioApiError";
    this.status = status;
    this.twilioCode = twilioCode;
  }
}

export function hasTwilio(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function getCreds(): { sid: string; token: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new TwilioConfigError();
  return { sid, token };
}

function authHeader(sid: string, token: string): string {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function twilioFetch(
  path: string,
  init: { method?: string; body?: URLSearchParams; query?: Record<string, string | undefined> } = {},
): Promise<any> {
  const { sid, token } = getCreds();
  const url = new URL(`${TWILIO_API_BASE}/Accounts/${sid}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    Authorization: authHeader(sid, token),
    Accept: "application/json",
  };
  if (init.body) headers["content-type"] = "application/x-www-form-urlencoded";

  const res = await fetch(url.toString(), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave json null */
  }
  if (!res.ok) {
    const msg = json?.message ?? text ?? `Twilio HTTP ${res.status}`;
    throw new TwilioApiError(msg, res.status, json?.code);
  }
  return json;
}

/**
 * Search Twilio for available phone numbers to purchase.
 * country: ISO-2 country code (FR, US, GB, ...)
 * type:    'local' | 'mobile' | 'tollfree'  (default 'local')
 * areaCode: optional area code (US/CA only — Twilio ignores it elsewhere)
 */
export async function searchAvailableNumbers(opts: {
  country: string;
  type?: "local" | "mobile" | "tollfree";
  areaCode?: string;
}): Promise<TwilioAvailableNumber[]> {
  const type = opts.type ?? "local";
  const bucket =
    type === "tollfree" ? "TollFree" : type === "mobile" ? "Mobile" : "Local";
  const country = opts.country.toUpperCase();
  const res = await twilioFetch(
    `/AvailablePhoneNumbers/${encodeURIComponent(country)}/${bucket}.json`,
    {
      query: {
        AreaCode: opts.areaCode,
        PageSize: "20",
      },
    },
  );
  const arr: any[] = res?.available_phone_numbers ?? [];
  return arr.map((n) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    isoCountry: n.iso_country,
    locality: n.locality ?? null,
    region: n.region ?? null,
    capabilities: pickCaps(n.capabilities),
  }));
}

/**
 * Purchase a Twilio number and wire its Voice webhook to our /api/twilio-voice route.
 */
export async function purchaseNumber(opts: {
  phoneNumber: string;
  webhookUrl: string;
}): Promise<TwilioIncomingNumber> {
  const body = new URLSearchParams();
  body.set("PhoneNumber", opts.phoneNumber);
  body.set("VoiceUrl", opts.webhookUrl);
  body.set("VoiceMethod", "POST");
  const res = await twilioFetch(`/IncomingPhoneNumbers.json`, {
    method: "POST",
    body,
  });
  return mapIncoming(res);
}

/**
 * Release (delete) a Twilio number we own. Idempotent: a 404 is swallowed.
 */
export async function releaseNumber(sid: string): Promise<void> {
  try {
    await twilioFetch(`/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof TwilioApiError && err.status === 404) return;
    throw err;
  }
}

/**
 * Fetch a single number by SID (used to surface live status next to the Supabase row).
 */
export async function getIncomingNumber(sid: string): Promise<TwilioIncomingNumber | null> {
  try {
    const res = await twilioFetch(
      `/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`,
    );
    return mapIncoming(res);
  } catch (err) {
    if (err instanceof TwilioApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Look up an IncomingPhoneNumber on the connected Twilio account by E.164.
 * Returns null when the account doesn't own that number — the caller can
 * surface a clean "ce numéro n'est pas sur ce compte Twilio" message
 * instead of a raw 404 stack.
 */
export async function findIncomingNumberByE164(
  e164: string,
): Promise<TwilioIncomingNumber | null> {
  const res = await twilioFetch(`/IncomingPhoneNumbers.json`, {
    query: { PhoneNumber: e164 },
  });
  const arr: any[] = res?.incoming_phone_numbers ?? [];
  if (arr.length === 0) return null;
  return mapIncoming(arr[0]);
}

function mapIncoming(n: any): TwilioIncomingNumber {
  return {
    sid: n.sid,
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    voiceUrl: n.voice_url ?? null,
    smsUrl: n.sms_url ?? null,
    capabilities: pickCaps(n.capabilities),
  };
}

function pickCaps(c: any): { voice: boolean; sms: boolean; mms: boolean; fax: boolean } {
  const caps = c ?? {};
  return {
    voice: !!caps.voice,
    // Twilio returns capability keys in upper-case for available numbers
    // (SMS/MMS) but lower-case for owned numbers — accept either.
    sms: !!(caps.SMS ?? caps.sms),
    mms: !!(caps.MMS ?? caps.mms),
    fax: !!caps.fax,
  };
}

/**
 * Place an outbound call via Twilio's REST API.
 * Twilio will POST `twimlUrl` once the call is answered to fetch instructions.
 *
 * If `amd` is true, Twilio runs Answering Machine Detection and the result
 * is sent via the AsyncAmdStatusCallback (or the regular status callback).
 */
export async function createCall(opts: {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallback?: string;
  amd?: boolean;
  timeout?: number;
}): Promise<{ sid: string; status: string }> {
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
  if (opts.amd) {
    body.set("MachineDetection", "DetectMessageEnd");
  }
  if (opts.timeout !== undefined) {
    body.set("Timeout", String(opts.timeout));
  }
  const res = await twilioFetch(`/Calls.json`, { method: "POST", body });
  return { sid: res?.sid, status: res?.status };
}

/**
 * Update an in-flight call. Used to swap the active TwiML — e.g. to play
 * hold music or to redirect the call back to its original handler.
 *
 * Either `twiml` (inline) or `url` (TwiML hosted at a URL) must be set.
 */
export async function updateCall(opts: {
  sid: string;
  twiml?: string;
  url?: string;
  method?: "GET" | "POST";
  status?: "completed" | "canceled";
}): Promise<{ sid: string; status: string }> {
  const body = new URLSearchParams();
  if (opts.twiml) body.set("Twiml", opts.twiml);
  if (opts.url) {
    body.set("Url", opts.url);
    body.set("Method", opts.method ?? "POST");
  }
  if (opts.status) body.set("Status", opts.status);
  const res = await twilioFetch(`/Calls/${encodeURIComponent(opts.sid)}.json`, {
    method: "POST",
    body,
  });
  return { sid: res?.sid, status: res?.status };
}

/** Default Twilio hold music — they host this publicly. */
export const DEFAULT_HOLD_MUSIC_URL = "http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3";

/**
 * Build the public webhook URL Twilio should hit when a call comes in.
 * Prefers the explicit NEXT_PUBLIC_APP_URL, then VERCEL_URL, then a passed origin.
 */
export function defaultWebhookUrl(originFromRequest?: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return trimSlash(explicit) + "/api/twilio-voice";
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${trimSlash(vercel)}/api/twilio-voice`;
  if (originFromRequest) return trimSlash(originFromRequest) + "/api/twilio-voice";
  return "https://example.com/api/twilio-voice";
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
