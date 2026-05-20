import crypto from "crypto";

/**
 * Helpers for the `axon.org_id` HttpOnly cookie that pins the currently-active
 * organisation for a session.
 *
 * Wire format (after signing):
 *
 *     <orgId>.<timestampMs>.<hmacSha256Hex>
 *
 * - `orgId`: UUID of the active org.
 * - `timestampMs`: unix ms the cookie was minted at.
 * - HMAC is computed over `${orgId}.${timestampMs}` with AXON_COOKIE_SECRET.
 *
 * Verification rejects:
 *   - malformed values,
 *   - bad signatures (constant-time compared),
 *   - timestamps older than `maxAgeSeconds` (defaults to 1h).
 *
 * Legacy unsigned values (a raw UUID) are accepted on read for backwards
 * compatibility but the next write upgrades them to the signed format.
 */

export const ORG_COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1h
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _warnedMissingSecret = false;
function getSecret(): string {
  const s = process.env.AXON_COOKIE_SECRET;
  if (s && s.length >= 16) return s;
  if (!_warnedMissingSecret) {
    console.warn(
      "[org-cookie] AXON_COOKIE_SECRET is missing or too short; falling back to a hardcoded default. Set AXON_COOKIE_SECRET (>= 16 chars) in production.",
    );
    _warnedMissingSecret = true;
  }
  return "axon-dev-fallback-cookie-secret-change-me";
}

function hmac(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

/** Mint a signed cookie value for an org id. */
export function signOrgCookie(orgId: string, nowMs: number = Date.now()): string {
  const secret = getSecret();
  const payload = `${orgId}.${nowMs}`;
  const sig = hmac(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Verify a signed (or legacy unsigned) cookie. Returns the org id when the
 * value is acceptable, or null when it should be ignored.
 */
export function verifyOrgCookie(
  value: string | null | undefined,
  opts: { maxAgeSeconds?: number; nowMs?: number } = {},
): string | null {
  if (!value) return null;
  const maxAge = (opts.maxAgeSeconds ?? ORG_COOKIE_MAX_AGE_SECONDS) * 1000;
  const now = opts.nowMs ?? Date.now();

  // Legacy unsigned format: a bare UUID. Accepted for backwards compatibility
  // until callers refresh their cookie.
  if (UUID_RE.test(value)) return value;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [orgId, tsStr, sig] = parts;
  if (!UUID_RE.test(orgId)) return null;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (Math.abs(now - ts) > maxAge) return null;

  const expected = hmac(`${orgId}.${ts}`, getSecret());
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || a.length === 0) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return orgId;
}

/** Default cookie attributes for `axon.org_id`. */
export function orgCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: ORG_COOKIE_MAX_AGE_SECONDS,
  };
}
