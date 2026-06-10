// Strips telephony plumbing out of a raw "phone" value so the dashboard never
// shows a SIP URI or a Twilio Client identity where a number (or a person's
// name) belongs.
//
// Twilio's call logs store the counterparty in several non-E.164 shapes:
//   "sip:+447888861445@xyz.sip.livekit.cloud"  → SIP URI wrapping the real number
//   "sip:+447888861445@public-vip.ie1.twilio.com" → same, Twilio edge host
//   "client:user-ac25040f-5fde-4032-..."        → a browser SDK (desk softphone)
//                                                  leg — an identity, not a number
//   "+447367280407"                             → already clean
//
// `cleanPhone` recovers the embedded E.164 when present and returns null for
// identities that carry no real number, so a downstream `name ?? phone ?? "—"`
// chain shows a real number/name or a dash — never `client:user-…`.

const E164_IN_TEXT = /\+?\d[\d\s().-]{5,20}\d/;

// Leading tokens that mean "this is telephony plumbing, not a person/number".
const IDENTITY_PREFIX = /^(client:|sips?:|tel:|pstn|anonymous|unknown|restricted|user[-_])/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toE164(digits: string): string | null {
  const cleaned = digits.replace(/[^\d+]/g, "");
  const body = cleaned.replace(/^\+/, "");
  if (body.length < 6 || body.length > 15) return null;
  return "+" + body;
}

export function cleanPhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (!v) return null;

  // SIP / tel URI: the real number sits in the user part before the '@'.
  if (/^sips?:|^tel:/i.test(v)) {
    const userPart = v.replace(/^sips?:|^tel:/i, "").split("@")[0] ?? "";
    const m = userPart.match(E164_IN_TEXT);
    return m ? toE164(m[0]) : null;
  }

  // Twilio Client / SDK identity, bare UUID, anonymous/withheld caller → no number.
  if (IDENTITY_PREFIX.test(v) || UUID.test(v)) return null;

  // Otherwise treat it as a phone if it actually contains digits.
  if (!/\d/.test(v)) return null;
  return toE164(v) ?? null;
}

// Sanitises a *name* (e.g. contacts.display_name). Returns null when the value
// is actually a telephony identity string rather than a human name, so callers
// fall through to a real name lookup instead of rendering `client:user-…`.
export function cleanName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (IDENTITY_PREFIX.test(v) || UUID.test(v)) return null;
  return v;
}
