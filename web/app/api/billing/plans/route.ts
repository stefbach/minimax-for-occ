import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/plans
 *
 * Returns the public plan catalog ordered by price. Available to any
 * authenticated user; we only expose price/limits, not stripe internals.
 */
export async function GET() {
  if (!hasSupabase()) {
    // Fall back to a hard-coded catalog when running without Supabase
    // (e.g. in local CI builds) so the UI still renders.
    return NextResponse.json([
      { slug: "starter",    name: "Starter",    monthly_price_cents: 4900,   included_minutes: 500,   included_llm_tokens: 500000,   included_tts_chars: 100000,   included_stt_minutes: 500 },
      { slug: "pro",        name: "Pro",        monthly_price_cents: 19900,  included_minutes: 3000,  included_llm_tokens: 5000000,  included_tts_chars: 1000000,  included_stt_minutes: 3000 },
      { slug: "enterprise", name: "Enterprise", monthly_price_cents: 99900,  included_minutes: 30000, included_llm_tokens: 50000000, included_tts_chars: 10000000, included_stt_minutes: 30000 },
    ]);
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("plans")
    .select(
      "slug, name, monthly_price_cents, included_minutes, included_llm_tokens, included_tts_chars, included_stt_minutes",
    )
    .order("monthly_price_cents", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
