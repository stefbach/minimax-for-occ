import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/twilio-token
 *
 * Mints a short-lived Twilio Voice Access Token for the authenticated user.
 * The browser then feeds it to `Twilio.Device(token)` to register and place
 * outbound calls directly via Twilio Voice (WebRTC ↔ Twilio ↔ PSTN), which
 * sidesteps the LiveKit-SIP-outbound 403s we hit on Elastic SIP Trunking.
 *
 * Required env (all from Twilio Console → Account → API keys & tokens):
 *   TWILIO_ACCOUNT_SID       e.g. AC...
 *   TWILIO_API_KEY_SID       e.g. SK...   (create one via "API keys")
 *   TWILIO_API_KEY_SECRET    paired with the key
 *   TWILIO_TWIML_APP_SID     e.g. AP...   (TwiML App pointing at
 *                                          /api/twilio/voice-outbound)
 *
 * Token format: standard Twilio JWT with a VoiceGrant. We sign it
 * manually here (HMAC-SHA256) so we don't need to pull the entire
 * twilio Node SDK just for token minting.
 */
export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    return NextResponse.json(
      {
        error:
          "Twilio Voice SDK env missing — need TWILIO_ACCOUNT_SID, " +
          "TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID. " +
          "See /settings or agent/sip/README.md for the setup steps.",
      },
      { status: 500 },
    );
  }

  // Identify the caller — used by the TwiML app to attribute the call.
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const identity = `user-${user.id}`;
  const ttlSeconds = 60 * 60; // 1h, the SDK refreshes itself before expiry

  const token = mintTwilioAccessToken({
    accountSid,
    apiKeySid,
    apiKeySecret,
    twimlAppSid,
    identity,
    ttlSeconds,
  });

  return NextResponse.json({ token, identity, expiresIn: ttlSeconds });
}

/**
 * Sign a Twilio Access Token JWT with a Voice grant.
 *
 * Spec: https://www.twilio.com/docs/iam/access-tokens
 *   - alg: HS256
 *   - iss: API Key SID
 *   - sub: Account SID
 *   - exp: now + ttl
 *   - grants.identity, grants.voice.outgoing.application_sid
 *
 * We compute the JWS inline so this route stays dependency-light.
 */
function mintTwilioAccessToken(args: {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  identity: string;
  ttlSeconds: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${args.apiKeySid}-${now}`,
    iss: args.apiKeySid,
    sub: args.accountSid,
    nbf: now,
    exp: now + args.ttlSeconds,
    grants: {
      identity: args.identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: args.twimlAppSid },
      },
    },
  };

  const encB64 = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const signingInput = `${encB64(header)}.${encB64(payload)}`;

  // crypto.createHmac in Node, available in Vercel's Node runtime.
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const sig = crypto
    .createHmac("sha256", args.apiKeySecret)
    .update(signingInput)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${sig}`;
}
