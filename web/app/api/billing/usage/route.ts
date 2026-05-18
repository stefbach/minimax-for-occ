import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { getMonthUsage, getOrgPlan } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/usage
 *
 * Returns the current-month usage for the caller's org, broken down by
 * event_type, alongside the org's plan limits for direct UI comparison.
 *
 *   {
 *     org_id, plan: { slug, name, ... },
 *     month: "2026-05",
 *     usage: {
 *       call_minutes: { quantity, cost_cents, limit },
 *       llm_tokens:   { quantity, cost_cents, limit },
 *       tts_chars:    { quantity, cost_cents, limit },
 *       stt_minutes:  { quantity, cost_cents, limit }
 *     }
 *   }
 */
export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "supabase not configured" },
      { status: 503 },
    );
  }

  const orgId = await requestOrgId(req);
  const [plan, usage] = await Promise.all([
    getOrgPlan(orgId),
    getMonthUsage(orgId),
  ]);

  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  return NextResponse.json({
    org_id: orgId,
    month,
    plan: plan ?? {
      slug: "starter",
      name: "Starter",
      monthly_price_cents: 4900,
      included_minutes: 500,
      included_llm_tokens: 500000,
      included_tts_chars: 100000,
      included_stt_minutes: 500,
    },
    usage: {
      call_minutes: {
        ...usage.call_minutes,
        limit: plan?.included_minutes ?? 0,
      },
      llm_tokens: {
        ...usage.llm_tokens,
        limit: plan?.included_llm_tokens ?? 0,
      },
      tts_chars: {
        ...usage.tts_chars,
        limit: plan?.included_tts_chars ?? 0,
      },
      stt_minutes: {
        ...usage.stt_minutes,
        limit: plan?.included_stt_minutes ?? 0,
      },
    },
  });
}
