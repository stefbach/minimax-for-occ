import crypto from "crypto";

/**
 * Validate a Twilio webhook signature.
 *
 * Twilio signs the request URL + the alphabetically-sorted form-encoded body
 * with HMAC-SHA1 using the account auth token. See
 * https://www.twilio.com/docs/usage/security#validating-requests.
 *
 * We accept the parsed form payload (URLSearchParams or a plain record) so
 * callers can re-use the body they already parsed for their handler.
 *
 * Skip behaviour:
 *   - returns true if `process.env.TWILIO_SKIP_VALIDATION === "1"` (tests)
 *   - returns true if no `TWILIO_AUTH_TOKEN` is set AND we're not in production
 *     (dev convenience); logs a warning.
 *   - returns false (reject) in production when the token is missing.
 */
export function validateTwilioSignature(
  req: Request,
  body: string | URLSearchParams | Record<string, string> | FormData | null,
): boolean {
  if (process.env.TWILIO_SKIP_VALIDATION === "1") return true;

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[twilio-signature] TWILIO_AUTH_TOKEN missing — skipping validation in non-production.",
      );
      return true;
    }
    return false;
  }

  const sig = req.headers.get("x-twilio-signature");
  if (!sig) return false;

  // Twilio computes the signature against the *public* URL the request hit.
  // Behind a proxy (Vercel, Fly) the visible host/proto on req.url may differ
  // from what Twilio used to sign; prefer x-forwarded-* when present.
  const url = buildSigningUrl(req);

  const sortedBody = serializeBody(body);
  const data = url + sortedBody;

  const expected = crypto.createHmac("sha1", token).update(data).digest("base64");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function buildSigningUrl(req: Request): string {
  const u = new URL(req.url);
  const xfProto = req.headers.get("x-forwarded-proto");
  const xfHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (xfProto) u.protocol = xfProto.split(",")[0].trim() + ":";
  if (xfHost) {
    const host = xfHost.split(",")[0].trim();
    u.host = host;
  }
  // Twilio includes the full URL with query string, but does NOT include the
  // trailing fragment. URL serialisation already drops the fragment.
  return u.toString();
}

function serializeBody(
  body: string | URLSearchParams | Record<string, string> | FormData | null,
): string {
  if (body == null) return "";
  if (typeof body === "string") return body;

  let entries: Array<[string, string]> = [];
  if (body instanceof URLSearchParams) {
    entries = Array.from(body.entries());
  } else if (typeof FormData !== "undefined" && body instanceof FormData) {
    body.forEach((v, k) => {
      entries.push([k, typeof v === "string" ? v : ""]);
    });
  } else {
    entries = Object.entries(body as Record<string, string>);
  }

  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}${v}`).join("");
}
