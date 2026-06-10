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
      // Fractional cents preserved — per-call LLM/TTS/STT costs are sub-cent.
      cost_cents: Number.isFinite(costCents) ? costCents : 0,
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

/** Per-unit rate card, in cents. Override via env (CALL/LLM/TTS/STT_*_CENTS)
 *  so each deployment can match its real provider invoices. The QUANTITIES are
 *  measured (real Twilio minutes, real LLM tokens, real TTS chars, real STT
 *  minutes) — only these rates are configurable estimates.
 *
 *  Calibrated on OCC's ACTUAL provider plans (June 2026):
 *    LiveKit    — free tier → no per-minute platform charge; the
 *                 call_minutes event therefore models TWILIO's bill only.
 *    Twilio     — ~$0.03/min UK mobile (Elastic SIP Trunking, single
 *                 Trunking-Terminating leg).
 *    Cartesia   — Pro $5/mo incl. 100K credits (1 credit/TTS char);
 *                 overage $65/M credits = 6.5¢/1k chars. Priced at the
 *                 overage rate since production volume blows past the
 *                 included credits within days; the $5 base is a fixed
 *                 overhead, not per-call.
 *    DeepSeek   — v4-flash measured blended (95-97% prompt-cache hits)
 *                 = $0.04-0.05 per MILLION tokens ≈ 0.005¢/1k.
 *    AssemblyAI — free plan today → 0. When the free credit runs out,
 *                 list is $0.15/hour = 0.25¢/min: set
 *                 RATE_STT_MIN_CENTS=0.25 at that point.
 *    Fly.io     — ~$5/mo fixed machines, not per-call (excluded). */
export const COST_RATES = {
  call_minute_cents: Number(process.env.RATE_CALL_MIN_CENTS ?? 2),
  llm_1k_tokens_cents: Number(process.env.RATE_LLM_1K_CENTS ?? 0.005),
  // Cartesia Pro $5/mo includes 100K credits/month (1 credit = 1 char).
  // OCC's June 10 daily volume is ~30K chars → we stay well inside the
  // included pool, so per-event cost is 0 cents. Once a tenant goes
  // past 100K/month we'd switch this to 6.5 (the overage rate
  // $65/M credits) — keep it env-overridable for that day.
  tts_1k_chars_cents: Number(process.env.RATE_TTS_1K_CENTS ?? 0),
  stt_minute_cents: Number(process.env.RATE_STT_MIN_CENTS ?? 0),
} as const;

/** Destination-aware Twilio call rate (cents per BILLED minute, i.e. minutes
 *  rounded up).
 *
 *  Real Twilio billing varies massively by destination:
 *    UK Local (+44 1/2/3)   £0.020/min
 *    UK Mobile (+447)        £0.025/min
 *    France (+33)            ~£0.025/min
 *    Mauritius Mobile (+230 5) £0.215/min — **10× more expensive**, watch out
 *    USA (+1)                £0.012/min
 *
 *  Cents in this codebase are USD; the rates below are roughly the GBP × 1.25
 *  conversion. Override per-tenant with the env vars listed if your invoices
 *  show different numbers. */
export function callRateCentsPerMinute(toE164: string | null | undefined): number {
  if (!toE164) return COST_RATES.call_minute_cents;
  const n = toE164.trim();
  if (n.startsWith("+447")) return Number(process.env.RATE_CALL_MIN_UK_MOBILE_CENTS ?? 3);
  if (n.startsWith("+44"))  return Number(process.env.RATE_CALL_MIN_UK_LOCAL_CENTS ?? 2.5);
  if (n.startsWith("+2305")) return Number(process.env.RATE_CALL_MIN_MAURITIUS_MOBILE_CENTS ?? 27);
  if (n.startsWith("+230"))  return Number(process.env.RATE_CALL_MIN_MAURITIUS_LOCAL_CENTS ?? 14);
  if (n.startsWith("+33"))   return Number(process.env.RATE_CALL_MIN_FR_CENTS ?? 3);
  if (n.startsWith("+1"))    return Number(process.env.RATE_CALL_MIN_US_CENTS ?? 1.5);
  return COST_RATES.call_minute_cents;
}

/** Cost in FRACTIONAL cents (no rounding — per-call components are sub-cent). */
export function estimateCostCents(
  eventType: UsageEventType,
  quantity: number,
  opts?: { destination?: string | null },
): number {
  switch (eventType) {
    case "call_minutes":
      // Twilio bills per started minute, so caller must already pass a
      // ceil'd value via secondsToBillableMinutes(duration). The rate
      // depends on the called number.
      return quantity * callRateCentsPerMinute(opts?.destination);
    case "llm_tokens":
      return (quantity / 1000) * COST_RATES.llm_1k_tokens_cents;
    case "tts_chars":
      return (quantity / 1000) * COST_RATES.tts_1k_chars_cents;
    case "stt_minutes":
      return quantity * COST_RATES.stt_minute_cents;
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
