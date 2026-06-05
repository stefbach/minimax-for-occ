import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hasSupabase } from "@/lib/supabase";
import { upsertRetellCall } from "@/lib/retell-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real-time Retell ingestion. Configure in the Retell dashboard:
//   Settings → Webhook URL: https://<domain>/api/retell/webhook
// Retell POSTs { event, call } on call_started / call_ended / call_analyzed.
// We upsert the call into Axon's `calls` on call_ended/analyzed so the
// dashboard reflects each call seconds after it finishes — no button, no cron
// lag. The hourly cron stays as a backstop for any webhook Retell drops.
//
// Org: single-tenant for now — resolved from RETELL_SYNC_ORG_ID (the OCC org).
// Signature: optional. Set RETELL_WEBHOOK_VERIFY=1 to enforce the
// X-Retell-Signature HMAC (keyed by RETELL_API_KEY) and reject forgeries.

type WebhookBody = {
  event?: string;
  call?: Record<string, unknown>;
};

function verifySignature(rawBody: string, signature: string | null): boolean {
  const key = process.env.RETELL_API_KEY;
  if (!key || !signature) return false;
  try {
    const expected = createHmac("sha256", key).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const orgId = process.env.RETELL_SYNC_ORG_ID;
  if (!orgId) {
    // Nothing we can attribute the call to — 200 so Retell doesn't retry forever.
    console.warn("[retell-webhook] RETELL_SYNC_ORG_ID not set; ignoring event");
    return NextResponse.json({ ok: false, error: "org_not_configured" }, { status: 200 });
  }

  const rawBody = await request.text();
  if (process.env.RETELL_WEBHOOK_VERIFY === "1") {
    const sig = request.headers.get("x-retell-signature");
    if (!verifySignature(rawBody, sig)) {
      return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
    }
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 200 });
  }

  const event = body.event ?? "unknown";
  const call = body.call;
  // Only terminal events carry the full call (duration, outcome, cost).
  // call_started has no outcome yet — skip it.
  if (event !== "call_ended" && event !== "call_analyzed") {
    return NextResponse.json({ ok: true, ignored: event });
  }
  if (!call || typeof call !== "object") {
    return NextResponse.json({ ok: false, error: "no_call" }, { status: 200 });
  }

  try {
    const res = await upsertRetellCall(orgId, call);
    console.log(`[retell-webhook] ${event} ${res.status} retell_id=${res.retell_id ?? "?"}`);
    return NextResponse.json({ ok: true, event, ...res });
  } catch (e) {
    // 500 so Retell retries — a transient DB blip shouldn't lose the call.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[retell-webhook] upsert failed: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Health probe so the operator can confirm the URL is reachable from Retell.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "retell-webhook",
    org_configured: Boolean(process.env.RETELL_SYNC_ORG_ID),
    signature_enforced: process.env.RETELL_WEBHOOK_VERIFY === "1",
  });
}
