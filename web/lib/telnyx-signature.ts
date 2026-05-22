import crypto from "crypto";

/**
 * Validate a Telnyx webhook signature (Ed25519).
 *
 * Telnyx signs requests with:
 *   telnyx-signature-ed25519  — base64-encoded Ed25519 signature
 *   telnyx-timestamp          — Unix timestamp in milliseconds
 *
 * The signed payload is: `${timestamp}|${rawBody}`
 * The public key is the "Webhook Signing Secret" from Telnyx portal →
 * Webhooks → your endpoint → Signing Secret (starts with "whsec_...").
 *
 * Tolerance: we reject signatures older than 5 minutes to prevent replay attacks.
 *
 * Skip behaviour:
 *   - returns true if `TELNYX_SKIP_VALIDATION === "1"` (dev/test)
 *   - returns true if no signing secret is set AND not in production
 *   - returns false (reject) in production when the secret is missing
 */
export async function validateTelnyxSignature(
  req: Request,
  rawBody: string,
): Promise<boolean> {
  if (process.env.TELNYX_SKIP_VALIDATION === "1") return true;

  const signingSecret = process.env.TELNYX_WEBHOOK_SECRET;
  if (!signingSecret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[telnyx-signature] TELNYX_WEBHOOK_SECRET missing — skipping validation in non-production.",
      );
      return true;
    }
    return false;
  }

  const sig = req.headers.get("telnyx-signature-ed25519");
  const timestamp = req.headers.get("telnyx-timestamp");
  if (!sig || !timestamp) return false;

  // Reject stale webhooks (> 5 min old)
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return false;
  }

  try {
    // Telnyx public key is a base64-encoded raw Ed25519 public key
    // (strip the "whsec_" prefix if present).
    const rawKey = signingSecret.startsWith("whsec_")
      ? signingSecret.slice(6)
      : signingSecret;
    const keyBytes = Buffer.from(rawKey, "base64");

    const publicKey = crypto.createPublicKey({
      key: keyBytes,
      format: "der",
      type: "spki",
    });

    const signedPayload = `${timestamp}|${rawBody}`;
    const sigBytes = Buffer.from(sig, "base64");

    return crypto.verify(
      null,
      Buffer.from(signedPayload, "utf-8"),
      publicKey,
      sigBytes,
    );
  } catch (err) {
    console.error("[telnyx-signature] verification error:", err);
    return false;
  }
}
