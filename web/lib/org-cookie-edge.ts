/**
 * Edge-runtime-safe verifier for the signed `axon.org_id` cookie.
 *
 * Mirrors `verifyOrgCookie` from ./org-cookie.ts but uses the WebCrypto
 * SubtleCrypto API instead of Node's `crypto` module so it can be imported by
 * `web/middleware.ts` (which runs in the Edge runtime).
 *
 * Wire format: see web/lib/org-cookie.ts.
 */

export const ORG_COOKIE_MAX_AGE_SECONDS = 60 * 60;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _warned = false;
function getSecret(): string {
  const s = process.env.AXON_COOKIE_SECRET;
  if (s && s.length >= 16) return s;
  if (!_warned) {
    console.warn(
      "[org-cookie-edge] AXON_COOKIE_SECRET is missing or too short; falling back to a hardcoded default. Set AXON_COOKIE_SECRET in production.",
    );
    _warned = true;
  }
  return "axon-dev-fallback-cookie-secret-change-me";
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  // Constant-time-ish comparison in pure JS.
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toHex(sig);
}

/**
 * Verify a signed (or legacy unsigned) cookie value. Returns the org id when
 * acceptable, or null when it should be ignored.
 */
export async function verifyOrgCookieEdge(
  value: string | null | undefined,
  opts: { maxAgeSeconds?: number; nowMs?: number } = {},
): Promise<string | null> {
  if (!value) return null;
  const maxAge = (opts.maxAgeSeconds ?? ORG_COOKIE_MAX_AGE_SECONDS) * 1000;
  const now = opts.nowMs ?? Date.now();

  // Legacy unsigned format: a bare UUID.
  if (UUID_RE.test(value)) return value;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [orgId, tsStr, sig] = parts;
  if (!UUID_RE.test(orgId)) return null;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (Math.abs(now - ts) > maxAge) return null;

  const expected = await hmacHex(`${orgId}.${ts}`, getSecret());
  if (!hexEqual(sig.toLowerCase(), expected.toLowerCase())) return null;
  return orgId;
}
