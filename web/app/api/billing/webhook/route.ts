import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook   — Stripe webhook endpoint (skeleton)
 *
 *   · Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET
 *     using HMAC-SHA256 (replicates `stripe.webhooks.constructEvent` so
 *     we don't bring in the stripe npm dep just for the skeleton).
 *   · On `checkout.session.completed` and `customer.subscription.*`
 *     events, updates organizations.subscription_status / plan_slug /
 *     stripe_* columns from event metadata.
 *
 * The signature step is skipped when STRIPE_WEBHOOK_SECRET is not set,
 * which keeps the route usable for local smoke-tests but should never
 * be the case in production.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sigHeader = req.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (secret) {
    if (!verifyStripeSignature(raw, sigHeader, secret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    }
  } else {
    console.warn("[billing/webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = supabaseServer();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data?.object as CheckoutSession | undefined;
        const orgId = s?.client_reference_id ?? s?.metadata?.org_id;
        const planSlug = s?.metadata?.plan_slug;
        if (orgId) {
          await sb
            .from("organizations")
            .update({
              plan_slug: planSlug ?? undefined,
              stripe_customer_id: s?.customer ?? undefined,
              stripe_subscription_id: s?.subscription ?? undefined,
              subscription_status: "active",
            })
            .eq("id", orgId);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data?.object as Subscription | undefined;
        const orgId = sub?.metadata?.org_id;
        if (orgId) {
          await sb
            .from("organizations")
            .update({
              subscription_status: sub?.status ?? "active",
              stripe_subscription_id: sub?.id ?? undefined,
            })
            .eq("id", orgId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data?.object as Subscription | undefined;
        const orgId = sub?.metadata?.org_id;
        if (orgId) {
          await sb
            .from("organizations")
            .update({
              subscription_status: "canceled",
              plan_slug: "starter",
            })
            .eq("id", orgId);
        }
        break;
      }
      default:
        // Ignore unrecognized events — Stripe expects 2xx anyway.
        break;
    }
  } catch (e) {
    console.error(
      "[billing/webhook] handler error:",
      e instanceof Error ? e.message : String(e),
    );
    // Still return 200 so Stripe doesn't infinitely retry on a code bug.
  }

  return NextResponse.json({ received: true });
}

// ── Stripe signature verification (no SDK) ────────────────────────────────
function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): boolean {
  // header format: "t=<timestamp>,v1=<sig>,v1=<sig>,…"
  const parts = header.split(",").map((p) => p.trim());
  let timestamp: string | null = null;
  const sigs: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t") timestamp = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!timestamp || sigs.length === 0) return false;

  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// ── Minimal Stripe event shapes (no SDK) ──────────────────────────────────
interface StripeEvent {
  type: string;
  data?: { object?: unknown };
}
interface CheckoutSession {
  client_reference_id?: string;
  customer?: string;
  subscription?: string;
  metadata?: { org_id?: string; plan_slug?: string };
}
interface Subscription {
  id?: string;
  status?: string;
  metadata?: { org_id?: string };
}
