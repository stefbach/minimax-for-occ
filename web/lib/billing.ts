import { supabaseServer, hasSupabase } from "./supabase";

/**
 * Canonical usage event types tracked by the billing system.
 *
 *   call_minutes — Twilio voice minutes (out + in, both directions)
 *   llm_tokens   — OpenAI / Anthropic / etc. completion + prompt tokens
 *   tts_chars    — MiniMax TTS characters synthesised
 *   stt_minutes  — Deepgram (or other) speech-to-text minutes
 */
export type UsageEventType =
  | "call_minutes"
  | "llm_tokens"
  | "tts_chars"
  | "stt_minutes";

export interface PlanLimits {
  slug: string;
  name: string;
  monthly_price_cents: number;
  included_minutes: number;
  included_llm_tokens: number;
  included_tts_chars: number;
  included_stt_minutes: number;
}

/**
 * Record a usage event. Best-effort: any DB error is logged and swallowed
 * so that billing tracking can never break a user-facing API.
 */
export async function recordUsage(
  orgId: string | null | undefined,
  eventType: UsageEventType | string,
  quantity: number,
  costCents: number = 0,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!orgId) return;
  if (!Number.isFinite(quantity) || quantity <= 0) return;
  if (!hasSupabase()) return;

  try {
    const sb = supabaseServer();
    const { error } = await sb.from("usage_events").insert({
      org_id: orgId,
      event_type: eventType,
      quantity,
      cost_cents: Math.round(costCents || 0),
      metadata,
    });
    if (error) {
      console.warn("[billing] recordUsage insert failed:", error.message);
    }
  } catch (e) {
    console.warn(
      "[billing] recordUsage threw:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Convenience: convert Twilio call duration (seconds) → minutes (rounded up
 * to a billable minute, matching Twilio's own per-minute billing model).
 */
export function secondsToBillableMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

/** Estimated cost helpers — all numbers in cents (1/100th of a USD/EUR). */
export const COST_RATES = {
  // Conservative blended estimates — refine once we have real invoices.
  call_minute_cents: 2,        // ~$0.02 / min Twilio outbound (FR/US mix)
  llm_1k_tokens_cents: 0.3,    // deepseek-chat blended in/out (~10x moins cher qu'OpenAI)
  tts_1k_chars_cents: 3,       // MiniMax speech-02
  stt_minute_cents: 1,         // Deepgram nova
} as const;

export function estimateCostCents(
  eventType: UsageEventType,
  quantity: number,
): number {
  switch (eventType) {
    case "call_minutes":
      return Math.round(quantity * COST_RATES.call_minute_cents);
    case "llm_tokens":
      return Math.round((quantity / 1000) * COST_RATES.llm_1k_tokens_cents);
    case "tts_chars":
      return Math.round((quantity / 1000) * COST_RATES.tts_1k_chars_cents);
    case "stt_minutes":
      return Math.round(quantity * COST_RATES.stt_minute_cents);
    default:
      return 0;
  }
}

/**
 * Load the plan currently assigned to an org. Falls back to 'starter'
 * if the org's plan_slug column is null or the plan row doesn't exist.
 */
export async function getOrgPlan(orgId: string): Promise<PlanLimits | null> {
  if (!hasSupabase()) return null;
  const sb = supabaseServer();
  const { data: org } = await sb
    .from("organizations")
    .select("plan_slug")
    .eq("id", orgId)
    .maybeSingle();
  const slug = (org?.plan_slug as string | undefined) ?? "starter";
  const { data: plan } = await sb
    .from("plans")
    .select(
      "slug, name, monthly_price_cents, included_minutes, included_llm_tokens, included_tts_chars, included_stt_minutes",
    )
    .eq("slug", slug)
    .maybeSingle();
  return (plan as PlanLimits | null) ?? null;
}

/**
 * Aggregate the current calendar-month usage for an org, grouped by
 * event_type. Always returns one entry per known event type (zero if no
 * events were recorded yet) so the UI can render a stable table.
 */
export async function getMonthUsage(orgId: string): Promise<
  Record<UsageEventType, { quantity: number; cost_cents: number }>
> {
  const zero = {
    call_minutes: { quantity: 0, cost_cents: 0 },
    llm_tokens:   { quantity: 0, cost_cents: 0 },
    tts_chars:    { quantity: 0, cost_cents: 0 },
    stt_minutes:  { quantity: 0, cost_cents: 0 },
  } as Record<UsageEventType, { quantity: number; cost_cents: number }>;

  if (!hasSupabase()) return zero;
  const sb = supabaseServer();

  // Start of the current month, in UTC.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const { data, error } = await sb
    .from("usage_events")
    .select("event_type, quantity, cost_cents")
    .eq("org_id", orgId)
    .gte("occurred_at", monthStart.toISOString());

  if (error || !data) return zero;

  for (const row of data as Array<{ event_type: string; quantity: number; cost_cents: number }>) {
    const k = row.event_type as UsageEventType;
    if (!zero[k]) continue;
    zero[k].quantity   += Number(row.quantity) || 0;
    zero[k].cost_cents += Number(row.cost_cents) || 0;
  }
  return zero;
}
