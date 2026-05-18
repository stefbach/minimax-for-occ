/**
 * Twilio number webhook configuration helpers.
 *
 * Used at purchase time and from /api/numbers/[id]/configure-webhook to
 * (re)wire VoiceUrl + StatusCallback on an existing IncomingPhoneNumber.
 */

import { TwilioApiError, TwilioConfigError } from "./twilio";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

function getCreds(): { sid: string; token: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new TwilioConfigError();
  return { sid, token };
}

function authHeader(sid: string, token: string): string {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Pick the public origin for webhook callbacks.
 * Prefers NEXT_PUBLIC_APP_URL, then VERCEL_URL, then the supplied origin.
 */
export function publicAppUrl(originFromRequest?: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return trimSlash(explicit);
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${trimSlash(vercel)}`;
  if (originFromRequest) return trimSlash(originFromRequest);
  return "https://example.com";
}

export interface ConfiguredWebhook {
  sid: string;
  voiceUrl: string;
  statusCallback: string;
  smsUrl: string | null;
}

/**
 * (Re)configure a Twilio IncomingPhoneNumber so inbound calls hit our
 * /api/twilio-voice handler and call lifecycle events POST to
 * /api/twilio-status. Returns the URLs we wired in.
 *
 * Throws TwilioConfigError if creds missing, TwilioApiError on HTTP failure.
 */
export async function configureNumberWebhooks(
  twilioSid: string,
  appUrl: string,
): Promise<ConfiguredWebhook> {
  const { sid, token } = getCreds();
  const base = trimSlash(appUrl);
  const voiceUrl = `${base}/api/twilio-voice`;
  const statusCallback = `${base}/api/twilio/status`;

  const body = new URLSearchParams();
  body.set("VoiceUrl", voiceUrl);
  body.set("VoiceMethod", "POST");
  body.set("StatusCallback", statusCallback);
  body.set("StatusCallbackMethod", "POST");

  const url = `${TWILIO_API_BASE}/Accounts/${sid}/IncomingPhoneNumbers/${encodeURIComponent(twilioSid)}.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(sid, token),
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const text = await res.text();
  let json: { sid?: string; voice_url?: string; status_callback?: string; sms_url?: string; message?: string; code?: number } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave null */
  }
  if (!res.ok) {
    const msg = json?.message ?? text ?? `Twilio HTTP ${res.status}`;
    throw new TwilioApiError(msg, res.status, json?.code);
  }

  return {
    sid: json?.sid ?? twilioSid,
    voiceUrl: json?.voice_url ?? voiceUrl,
    statusCallback: json?.status_callback ?? statusCallback,
    smsUrl: json?.sms_url ?? null,
  };
}

/**
 * Best-effort: try to configure webhooks but never throw. Returns ok=false
 * with a reason when Twilio can't be reached, so the caller can decide to
 * surface a warning without rolling back a purchase.
 */
export async function tryConfigureWebhooks(
  twilioSid: string,
  appUrl: string,
): Promise<{ ok: true; configured: ConfiguredWebhook } | { ok: false; error: string }> {
  try {
    const configured = await configureNumberWebhooks(twilioSid, appUrl);
    return { ok: true, configured };
  } catch (err) {
    if (err instanceof TwilioConfigError) return { ok: false, error: err.message };
    if (err instanceof TwilioApiError) return { ok: false, error: `Twilio: ${err.message}` };
    return { ok: false, error: err instanceof Error ? err.message : "Erreur Twilio inconnue" };
  }
}

/**
 * Derive ISO country code from an E.164 number. Covers the prefixes used
 * by Axon today; falls back to null when unknown.
 */
export function countryFromE164(e164: string): { code: string | null; prefix: string | null } {
  if (!e164 || !e164.startsWith("+")) return { code: null, prefix: null };
  // Order matters: longer prefixes first so "+1" doesn't shadow "+1809" etc.
  const TABLE: Array<{ prefix: string; code: string }> = [
    { prefix: "+230", code: "MU" }, // Mauritius
    { prefix: "+352", code: "LU" },
    { prefix: "+351", code: "PT" },
    { prefix: "+353", code: "IE" },
    { prefix: "+356", code: "MT" },
    { prefix: "+358", code: "FI" },
    { prefix: "+371", code: "LV" },
    { prefix: "+372", code: "EE" },
    { prefix: "+420", code: "CZ" },
    { prefix: "+421", code: "SK" },
    { prefix: "+33",  code: "FR" },
    { prefix: "+34",  code: "ES" },
    { prefix: "+39",  code: "IT" },
    { prefix: "+41",  code: "CH" },
    { prefix: "+44",  code: "GB" },
    { prefix: "+45",  code: "DK" },
    { prefix: "+46",  code: "SE" },
    { prefix: "+47",  code: "NO" },
    { prefix: "+48",  code: "PL" },
    { prefix: "+49",  code: "DE" },
    { prefix: "+30",  code: "GR" },
    { prefix: "+31",  code: "NL" },
    { prefix: "+32",  code: "BE" },
    { prefix: "+43",  code: "AT" },
    { prefix: "+1",   code: "US" }, // covers US + CA (Twilio sometimes returns CA, we accept either)
  ];
  for (const { prefix, code } of TABLE) {
    if (e164.startsWith(prefix)) return { prefix, code };
  }
  return { code: null, prefix: null };
}

/**
 * Map an ISO country to its default regulatory compliance jurisdiction.
 */
export function defaultJurisdictionForCountry(code: string | null): string | null {
  if (!code) return null;
  if (code === "US" || code === "CA") return "US_TCPA";
  if (code === "MU") return "MU_ICTA";
  const EU = new Set([
    "FR","DE","ES","IT","NL","BE","LU","PT","IE","AT","DK","SE","FI","GR",
    "PL","CZ","SK","HU","RO","BG","HR","SI","EE","LV","LT","MT","CY",
  ]);
  if (EU.has(code)) return "EU_GDPR";
  if (code === "GB") return "GDPR_UK";
  return "OTHER";
}
