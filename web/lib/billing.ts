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

/** Per-unit rate card, in cents. Override via env (CALL/LLM/TTS/STT/LIVEKIT_*_CENTS)
 *  so each deployment can match its real provider invoices. The QUANTITIES are
 *  measured (real Twilio minutes, real LLM tokens, real TTS chars, real STT
 *  minutes) — only these rates are configurable.
 *
 *  Calibrated on OCC's REAL production stack + invoices (July 2026), verified
 *  against the live agents table and the provider billing portals:
 *    Twilio     — telephony; reconciled to the ACTUAL billed price per call by
 *                 the sync-twilio cron (call_minutes event holds the real cost).
 *    AssemblyAI — STT, Universal-3 Pro streaming = $0.45/hour = 0.75¢/min.
 *    ElevenLabs — TTS (Flash/Turbo), API rate $0.05 / 1000 chars = 5¢/1k.
 *                 (The prod agents' tts_voice_id starts with "elevenlabs:".)
 *    LiveKit    — PAID "Ship" plan. Blended ≈ 1.7¢ per agent-session minute
 *                 from the real June invoice (~$224 / ~13.3k min: $50 base +
 *                 $0.01/min session overage + $0.004/min SIP + observability).
 *                 The LLM (OpenAI gpt-4.1-mini for calls, Anthropic for post-
 *                 call) runs through LiveKit Inference and is INCLUDED in this
 *                 plan — so llm_tokens are shown for info only and priced at 0
 *                 to avoid double-counting the LiveKit line.
 *    Fly.io     — ~fixed monthly machines, not per-call (excluded). */
export const COST_RATES = {
  call_minute_cents: Number(process.env.RATE_CALL_MIN_CENTS ?? 2),
  // LLM served via LiveKit Inference → cost is bundled in the LiveKit plan.
  // Kept at 0 so the LLM card is informational (tokens) without double-counting.
  llm_1k_tokens_cents: Number(process.env.RATE_LLM_1K_CENTS ?? 0),
  // ElevenLabs Flash/Turbo API: $0.05 per 1,000 characters.
  tts_1k_chars_cents: Number(process.env.RATE_TTS_1K_CENTS ?? 5),
  // AssemblyAI Universal-3 Pro streaming: $0.45/hour = 0.75¢/min.
  stt_minute_cents: Number(process.env.RATE_STT_MIN_CENTS ?? 0.75),
  // LiveKit "Ship" plan blended per-agent-session-minute (see comment above).
  livekit_minute_cents: Number(process.env.RATE_LIVEKIT_MIN_CENTS ?? 1.7),
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
