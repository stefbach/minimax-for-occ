/**
 * Twilio → Axon `calls` reconciliation.
 *
 * The Twilio StatusCallback webhook is the PRIMARY, real-time source of truth
 * for Axon calls. This sync is a safety net: it pulls Twilio's own call list
 * via the REST API and reconciles it into `calls`, so a call is never lost when
 * a webhook is dropped, arrives out of order, or never fires (provider hiccup).
 *
 * Idempotent: rows are keyed by metadata.twilio_call_sid (== Twilio CallSid).
 *  - new CallSid              → INSERT a full row.
 *  - existing row, still in   → UPDATE state/ended/duration from Twilio (fixes a
 *    a non-terminal state       call stuck "ringing" because its terminal
 *                               webhook was lost).
 *  - existing, already        → SKIP (the webhook's data wins; we don't clobber).
 *    terminal
 */

import { supabaseServer } from "./supabase";

const TWILIO_API = "https://api.twilio.com";
const ACTIVE_DB_STATES = new Set(["queued", "ringing", "ivr", "in_progress", "wrap_up"]);

// No-answer-ish Twilio statuses → not a real conversation.
function mapState(twilioStatus: string | undefined): "ended" | "failed" {
  switch (twilioStatus) {
    case "completed":
      return "ended";
    default:
      return "failed"; // busy | no-answer | failed | canceled
  }
}

interface TwilioCall {
  sid?: string;
  from?: string;
  to?: string;
  status?: string;
  direction?: string; // 'inbound' | 'outbound-api' | 'outbound-dial'
  duration?: string; // seconds (full leg, incl. ring)
  start_time?: string;
  end_time?: string;
  answered_by?: string; // human | machine_* | fax | unknown (only if AMD ran)
  price?: string | null; // what Twilio actually billed, NEGATIVE (e.g. "-0.04000")
  price_unit?: string | null; // currency of `price` (USD | GBP | EUR | …)
}

/** Convert a Twilio-billed amount to USD cents (our usage_events currency).
 *  Twilio rates in the account currency; override the fx via env if the
 *  account isn't USD. Returns null when the call hasn't been rated yet. */
function twilioPriceToCents(price: string | null | undefined, unit: string | null | undefined): number | null {
  if (price === null || price === undefined || price === "") return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n); // Twilio reports charges as negative numbers
  const cur = (unit ?? "USD").toUpperCase();
  const fx =
    cur === "USD" ? 1 :
    cur === "GBP" ? Number(process.env.TWILIO_FX_GBP_USD ?? 1.25) :
    cur === "EUR" ? Number(process.env.TWILIO_FX_EUR_USD ?? 1.1) :
    Number(process.env.TWILIO_FX_DEFAULT_USD ?? 1);
  return abs * 100 * fx;
}

function authHeader(): string | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  return "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64");
}

async function listTwilioCalls(sinceMs: number, maxCalls: number): Promise<TwilioCall[]> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = authHeader();
  if (!accountSid || !auth) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing");

  // Twilio filters StartTime by date (>=). Use the day of `since` so we don't
  // miss calls; we re-filter precisely by start_time below.
  const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);
  let path: string | null =
    `/2010-04-01/Accounts/${accountSid}/Calls.json?StartTime>=${sinceDate}&PageSize=1000`;
  const all: TwilioCall[] = [];
  for (let page = 0; page < 50 && path; page++) {
    const res = await fetch(`${TWILIO_API}${path}`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Twilio API ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { calls?: TwilioCall[]; next_page_uri?: string | null };
    for (const c of json.calls ?? []) all.push(c);
    if (all.length >= maxCalls) break;
    path = json.next_page_uri || null; // relative path or null
  }
  return all;
}

export interface TwilioSyncResult {
  fetched: number;
  inserted: number;
  reconciled: number; // stuck-active rows fixed to terminal
  skipped_existing: number;
  skipped_invalid: number;
  costs_priced?: number; // usage_events stamped with Twilio's real billed price
  error?: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export async function syncTwilioCalls(
  orgId: string,
  opts: { sinceMs?: number; maxCalls?: number } = {},
): Promise<TwilioSyncResult> {
  const sinceMs = opts.sinceMs ?? Date.now() - 2 * 86400_000;
  const maxCalls = Math.min(opts.maxCalls ?? 5000, 50000);
  const sb = supabaseServer();

  const raw = await listTwilioCalls(sinceMs, maxCalls);
  // Precise time filter (Twilio's StartTime is day-granular).
  const calls = raw.filter((c) => {
    const t = c.start_time ? Date.parse(c.start_time) : NaN;
    return Number.isFinite(t) && t >= sinceMs;
  });
  console.log(`[twilio-sync] org=${orgId} fetched=${raw.length} in-window=${calls.length}`);

  // Map existing rows for these CallSids in one query.
  const sids = calls.map((c) => str(c.sid)).filter(Boolean) as string[];
  const existing = new Map<string, { id: string; state: string | null }>();
  const CHUNK = 300;
  for (let i = 0; i < sids.length; i += CHUNK) {
    const slice = sids.slice(i, i + CHUNK);
    const { data } = await sb
      .from("calls")
      .select("id, state, metadata")
      .eq("org_id", orgId)
      .in("metadata->>twilio_call_sid", slice);
    for (const r of (data ?? []) as Array<{ id: string; state: string | null; metadata: { twilio_call_sid?: string } | null }>) {
      const sid = r.metadata?.twilio_call_sid;
      if (sid) existing.set(sid, { id: r.id, state: r.state });
    }
  }

  let inserted = 0;
  let reconciled = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  const toInsert: Record<string, unknown>[] = [];
  // Every Twilio call we can tie to an Axon calls.id gets its REAL billed
  // price reconciled into usage_events below.
  const costItems: CostItem[] = [];
  const toInsertTw: TwilioCall[] = []; // parallel to toInsert, for cost items

  for (const c of calls) {
    const sid = str(c.sid);
    if (!sid) { skippedInvalid += 1; continue; }
    const startMs = c.start_time ? Date.parse(c.start_time) : NaN;
    if (!Number.isFinite(startMs)) { skippedInvalid += 1; continue; }
    // Drop Twilio's INTERNAL trunk legs. When LK→Twilio SIP outbound
    // fires, Twilio logs BOTH the PSTN leg (to=+447xxxx, the one we
    // want) AND the trunk-side leg (to=sip:+447xxxx@public-vip.de1.
    // twilio.com — Twilio's German/Irish data centers). The trunk
    // leg has no patient-facing meaning and was inflating Wati's
    // dashboard from 312 → 1322 calls. They're identifiable by the
    // sip: scheme on the `to` field.
    const toRaw = (c.to ?? "").toLowerCase();
    if (toRaw.startsWith("sip:") || toRaw.includes("twilio.com")) {
      skippedInvalid += 1;
      continue;
    }

    const state = mapState(c.status);
    const duration = Number(c.duration) || 0;
    const answeredBy = (c.answered_by ?? "").toLowerCase();
    const isVoicemail = answeredBy.startsWith("machine_");
    const answered = c.status === "completed" && duration >= 15 && !isVoicemail;
    const direction: "in" | "out" = (c.direction ?? "").startsWith("inbound") ? "in" : "out";

    const row = existing.get(sid);
    if (row) {
      costItems.push({
        callId: row.id,
        sid,
        status: c.status ?? "",
        durationSecs: duration,
        priceCents: twilioPriceToCents(c.price, c.price_unit),
        priceRaw: c.price ?? null,
        priceUnit: c.price_unit ?? null,
      });
      // Only reconcile a row the webhook left stuck in an active state.
      if (ACTIVE_DB_STATES.has(row.state ?? "")) {
        await sb.from("calls").update({
          state,
          ended_at: c.end_time ? new Date(c.end_time).toISOString() : new Date().toISOString(),
          duration_secs: duration,
        }).eq("id", row.id).eq("org_id", orgId);
        reconciled += 1;
      } else {
        skippedExisting += 1;
      }
      continue;
    }

    // Before inserting: look for an existing agent-side row matching
    // by to_e164 + start time (the agent inserts its row 1-2 s before
    // Twilio's INVITE timestamp, and the twilio_call_sid is stamped
    // later by the deferred SID-poll task). Without this fallback the
    // sync created a second row for every SID-less agent row, exploding
    // Wati's June 10 list from 312 → 1322 calls.
    const toE164 = str(c.to);
    let backfilled = false;
    if (toE164) {
      const startWindowMs = 90_000; // ±90 s window around Twilio's start
      const since = new Date(startMs - startWindowMs).toISOString();
      const until = new Date(startMs + startWindowMs).toISOString();
      const { data: nearby } = await sb
        .from("calls")
        .select("id, metadata")
        .eq("org_id", orgId)
        .eq("to_e164", toE164)
        .gte("started_at", since)
        .lte("started_at", until)
        .limit(2);
      const match = (nearby ?? []).find(
        (r: { metadata: { twilio_call_sid?: string } | null }) =>
          !(r.metadata?.twilio_call_sid),
      );
      if (match) {
        // Write the SID to BOTH the top-level column AND metadata. The
        // recording-status webhook looks up by `calls.twilio_call_sid`
        // (column), so a sync row that only stamped metadata stayed
        // invisible — leaving 33% of answered calls with no recording_url
        // on June 11. Stamping the column closes that gap.
        await sb.from("calls").update({
          twilio_call_sid: sid,
          metadata: { ...(match.metadata ?? {}), twilio_call_sid: sid, twilio_last_status: c.status ?? null },
        }).eq("id", match.id).eq("org_id", orgId);
        costItems.push({
          callId: match.id,
          sid,
          status: c.status ?? "",
          durationSecs: duration,
          priceCents: twilioPriceToCents(c.price, c.price_unit),
          priceRaw: c.price ?? null,
          priceUnit: c.price_unit ?? null,
        });
        reconciled += 1;
        backfilled = true;
      }
    }
    if (backfilled) continue;

    // No nearby agent row either — this is a genuinely new call (rare).
    toInsertTw.push(c);
    toInsert.push({
      org_id: orgId,
      direction,
      state,
      from_e164: str(c.from),
      to_e164: toE164,
      started_at: new Date(startMs).toISOString(),
      answered_at: answered ? new Date(startMs).toISOString() : null,
      ended_at: c.end_time ? new Date(c.end_time).toISOString() : null,
      duration_secs: duration,
      disposition: isVoicemail ? "voicemail" : c.status === "completed" ? "answered" : c.status ?? null,
      metadata: { source: "twilio_sync", twilio_call_sid: sid, twilio_last_status: c.status ?? null },
    });
  }

  const INS = 500;
  for (let i = 0; i < toInsert.length; i += INS) {
    const chunk = toInsert.slice(i, i + INS);
    const { data, error } = await sb.from("calls").insert(chunk).select("id");
    if (error) throw new Error(error.message);
    inserted += (data ?? []).length;
    // insert(...).select() returns rows in insertion order → zip with the
    // parallel TwilioCall slice to know which calls.id belongs to which SID.
    const twChunk = toInsertTw.slice(i, i + INS);
    (data ?? []).forEach((r: { id: string }, j) => {
      const c = twChunk[j];
      if (!c?.sid) return;
      costItems.push({
        callId: r.id,
        sid: c.sid,
        status: c.status ?? "",
        durationSecs: Number(c.duration) || 0,
        priceCents: twilioPriceToCents(c.price, c.price_unit),
        priceRaw: c.price ?? null,
        priceUnit: c.price_unit ?? null,
      });
    });
  }

  let costsPriced = 0;
  try {
    costsPriced = await reconcileCallCosts(sb, orgId, costItems);
  } catch (e) {
    console.error(`[twilio-sync] cost reconciliation failed org=${orgId}:`, e instanceof Error ? e.message : e);
  }

  const result: TwilioSyncResult = {
    fetched: raw.length,
    inserted,
    reconciled,
    skipped_existing: skippedExisting,
    skipped_invalid: skippedInvalid,
    costs_priced: costsPriced,
  };
  console.log(`[twilio-sync] org=${orgId} done`, result);
  return result;
}

interface CostItem {
  callId: string;
  sid: string;
  status: string;
  durationSecs: number;
  priceCents: number | null; // null = Twilio hasn't rated the call yet
  priceRaw: string | null;
  priceUnit: string | null;
}

const TERMINAL_TW = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

/**
 * Overwrite the ESTIMATED call cost with what Twilio actually billed.
 *
 * The agent's fallback usage event measures the LK session (ring time +
 * dead-air included) at a rate-card price; Twilio's `price` field is the
 * invoice truth — connected talk-time only, and 0 for unanswered/failed
 * dials. One usage_events row per call (keyed metadata.call_id), updated in
 * place; once a row carries twilio_priced=true it's final and never touched
 * again, so the hourly cron converges instead of flapping.
 */
async function reconcileCallCosts(
  sb: ReturnType<typeof supabaseServer>,
  orgId: string,
  items: CostItem[],
): Promise<number> {
  // Only terminal calls; a completed call with price=null just hasn't been
  // rated yet — leave it for the next cron pass. Unanswered/failed dials are
  // genuinely free (price stays null forever) → real cost 0.
  const ready = items.filter(
    (it) => TERMINAL_TW.has(it.status) && (it.priceCents !== null || it.status !== "completed"),
  );
  if (ready.length === 0) return 0;

  // Existing call_minutes events for these calls, in chunks.
  const byCallId = new Map<string, { id: string; metadata: Record<string, unknown> | null }>();
  const CHUNK = 300;
  const callIds = ready.map((it) => it.callId);
  for (let i = 0; i < callIds.length; i += CHUNK) {
    const slice = callIds.slice(i, i + CHUNK);
    const { data } = await sb
      .from("usage_events")
      .select("id, metadata")
      .eq("org_id", orgId)
      .eq("event_type", "call_minutes")
      .in("metadata->>call_id", slice);
    for (const r of (data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>) {
      const cid = r.metadata?.call_id;
      if (typeof cid === "string") byCallId.set(cid, r);
    }
  }

  let priced = 0;
  for (const it of ready) {
    const costCents = it.priceCents ?? 0;
    const minutes = Math.ceil(it.durationSecs / 60); // Twilio bills per started minute
    const existing = byCallId.get(it.callId);
    if (existing) {
      if (existing.metadata?.twilio_priced === true) continue; // already final
      const { error } = await sb
        .from("usage_events")
        .update({
          quantity: minutes,
          cost_cents: costCents,
          metadata: {
            ...(existing.metadata ?? {}),
            twilio_priced: true,
            twilio_call_sid: it.sid,
            twilio_price: it.priceRaw,
            twilio_price_unit: it.priceUnit,
            twilio_duration_secs: it.durationSecs,
            twilio_status: it.status,
          },
        })
        .eq("id", existing.id);
      if (!error) priced += 1;
    } else if (costCents > 0 || minutes > 0) {
      // No estimate was ever written (webhook + fallback both missed) —
      // record the real bill directly. Free failed dials stay event-less.
      const { error } = await sb.from("usage_events").insert({
        org_id: orgId,
        event_type: "call_minutes",
        quantity: minutes,
        cost_cents: costCents,
        metadata: {
          source: "twilio_sync",
          call_id: it.callId,
          twilio_priced: true,
          twilio_call_sid: it.sid,
          twilio_price: it.priceRaw,
          twilio_price_unit: it.priceUnit,
          twilio_duration_secs: it.durationSecs,
          twilio_status: it.status,
        },
      });
      if (!error) priced += 1;
    }
  }
  if (priced > 0) console.log(`[twilio-sync] org=${orgId} priced ${priced} call cost(s) from Twilio invoices`);
  return priced;
}
