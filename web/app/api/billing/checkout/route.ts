import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout    body: { plan_slug }
 *
 * Creates a Stripe Checkout session for the given plan. Skeleton:
 *   · When STRIPE_SECRET_KEY is set, we call Stripe REST API directly
 *     (so we don't have to bundle the `stripe` npm package just for a
 *     skeleton path).
 *   · When STRIPE_SECRET_KEY is missing, we return a mock URL plus a
 *     `mock: true` flag so the UI can show a "demo" banner instead of
 *     redirecting to a real Stripe page.
 *
 * Either way we persist the chosen plan_slug on `organizations` so the
 * usage limits / Billing page reflect the upgrade immediately, even in
 * skeleton mode where there is no real webhook to confirm payment.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }

  let body: { plan_slug?: string } = {};
  try {
    body = (await req.json()) as { plan_slug?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const planSlug = (body.plan_slug || "").trim().toLowerCase();
  if (!planSlug) {
    return NextResponse.json({ error: "plan_slug required" }, { status: 400 });
  }

  const ctx = await requestContext(req);
  if (!ctx.user_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Only org admins (or super_admin) may upgrade.
  if (!ctx.is_super_admin && ctx.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseServer();
  const { data: plan } = await sb
    .from("plans")
    .select("slug, name, monthly_price_cents, stripe_price_id")
    .eq("slug", planSlug)
    .maybeSingle();
  if (!plan) {
    return NextResponse.json({ error: "plan not found" }, { status: 404 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const successUrl =
    process.env.STRIPE_SUCCESS_URL ??
    `${new URL(req.url).origin}/admin/billing?checkout=success`;
  const cancelUrl =
    process.env.STRIPE_CANCEL_URL ??
    `${new URL(req.url).origin}/admin/billing?checkout=cancel`;

  // ── Skeleton path: no Stripe key configured ───────────────────────────
  if (!stripeKey || !plan.stripe_price_id) {
    // Optimistically set the plan_slug on the org so the UI reflects the
    // change. In a real deployment this should happen in the webhook
    // after Stripe confirms payment.
    await sb
      .from("organizations")
      .update({
        plan_slug: plan.slug,
        subscription_status: "trial",
      })
      .eq("id", ctx.org_id);

    return NextResponse.json({
      mock: true,
      warning:
        "STRIPE_SECRET_KEY (or plans.stripe_price_id) is not configured. " +
        "Returning a mock checkout URL; the org plan was updated locally for demo purposes.",
      url: `${successUrl}&mock=1&plan=${encodeURIComponent(plan.slug)}`,
      plan_slug: plan.slug,
    });
  }

  // ── Real Stripe Checkout (skeleton: REST, no npm dep) ─────────────────
  try {
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("line_items[0][price]", plan.stripe_price_id);
    form.set("line_items[0][quantity]", "1");
    form.set("client_reference_id", ctx.org_id);
    form.set("metadata[org_id]", ctx.org_id);
    form.set("metadata[plan_slug]", plan.slug);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const json = (await res.json()) as { url?: string; id?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      return NextResponse.json(
        { error: json.error?.message ?? "stripe error" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      mock: false,
      url: json.url,
      session_id: json.id,
      plan_slug: plan.slug,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
