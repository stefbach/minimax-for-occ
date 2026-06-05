/**
 * Retell → Axon `calls` ingestion.
 *
 * OCC's production calling still runs on Retell; those calls only ever touched
 * `leads_rdv` (via n8n) and never created rows in Axon's `calls` table — which
 * is why the new dashboard showed ~2 calls when Retell had ~750. This pulls the
 * Retell call history and materialises it as native `calls` rows so EVERY
 * dashboard KPI (volume, durations, qualifications, cost, drill-down) works
 * against one source of truth.
 *
 * Design:
 *  - Idempotent: each row stores metadata.retell_call_id; a pre-pass loads the
 *    ids already synced in the window and skips them, so re-runs are safe.
 *  - Cost: Retell's combined_cost (cents) is written to usage_events with
 *    metadata.call_id = the new call id, matching how the dashboard reads cost.
 *  - Qualification: Retell call_outcome is stamped into metadata.qualification
 *    so bucketForCall classifies it exactly like a native Axon call. The AI
 *    auto-qualifier still backfills anything Retell left blank.
 */

import { supabaseServer } from "./supabase";

const RETELL_LIST_URL = "https://api.retellai.com/v2/list-calls";
const PAGE_LIMIT = 1000;

// No-answer disconnect reasons — mirrors the legacy dashboard so "answered"
// counts match what OCC was used to seeing.
const NO_ANSWER_DISCONNECTS = new Set([
  "dial_no_answer", "voicemail", "dial_busy", "dial_failed",
  "no_valid_payment", "inactivity",
]);

function isAnswered(durationSec: number, disconnect: string | null): boolean {
  if (durationSec < 15) return false;
  if (disconnect && NO_ANSWER_DISCONNECTS.has(disconnect)) return false;
  return true;
}

type RetellCall = Record<string, unknown>;

interface FetchOpts {
  sinceMs: number;
  maxCalls: number;
}

async function fetchRetellCallsSince({ sinceMs, maxCalls }: FetchOpts): Promise<RetellCall[]> {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY missing");
  const all: RetellCall[] = [];
  let paginationKey: string | undefined;
  for (let page = 0; page < 60; page++) {
    const body: Record<string, unknown> = {
      limit: PAGE_LIMIT,
      sort_order: "descending",
      ...(paginationKey ? { pagination_key: paginationKey } : {}),
      ...(sinceMs > 0
        ? { filter_criteria: { start_timestamp: { op: "ge", type: "number", value: sinceMs } } }
        : {}),
    };
    const res = await fetch(RETELL_LIST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Retell API ${res.status}: ${txt.slice(0, 240)}`);
    }
    const json = (await res.json()) as unknown;
    let items: RetellCall[];
    let nextKey: string | undefined;
    let hasMore = false;
    if (Array.isArray(json)) {
      items = json as RetellCall[];
      hasMore = items.length === PAGE_LIMIT;
      if (hasMore && items.length) nextKey = (items[items.length - 1] as { call_id?: string }).call_id;
    } else {
      const obj = (json ?? {}) as { items?: RetellCall[]; calls?: RetellCall[]; has_more?: boolean; pagination_key?: string };
      items = Array.isArray(obj.items) ? obj.items : Array.isArray(obj.calls) ? obj.calls : [];
      hasMore = obj.has_more === true;
      nextKey = obj.pagination_key;
    }
    all.push(...items);
    if (all.length >= maxCalls) break;
    if (!hasMore || !nextKey || items.length === 0) break;
    paginationKey = nextKey;
  }
  return all;
}

interface CallInsert {
  org_id: string;
  direction: "in" | "out";
  state: "ended" | "failed";
  from_e164: string | null;
  to_e164: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number;
  disposition: string | null;
  recording_url: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function mapCall(call: RetellCall, orgId: string): { row: CallInsert; retellId: string; costCents: number | null } | null {
  const retellId = str(call.call_id);
  if (!retellId) return null;
  const status = str(call.call_status);
  if (status === "ongoing" || status === "registered") return null; // only finished calls
  const state: "ended" | "failed" = status === "error" ? "failed" : "ended";

  const startMs = call.start_timestamp != null ? new Date(call.start_timestamp as number).getTime() : NaN;
  const endMs = call.end_timestamp != null ? new Date(call.end_timestamp as number).getTime() : NaN;
  if (!Number.isFinite(startMs)) return null;
  const duration = Number.isFinite(endMs) && Number.isFinite(startMs)
    ? Math.max(0, Math.floor((endMs - startMs) / 1000))
    : 0;

  const direction: "in" | "out" = call.direction === "inbound" ? "in" : "out";
  const fromNumber = str(call.from_number);
  const toNumber = str(call.to_number);
  const disconnect = str(call.disconnection_reason);
  const answered = isAnswered(duration, disconnect);

  const ca = (call.call_analysis ?? {}) as Record<string, unknown>;
  const cad = (ca.custom_analysis_data ?? {}) as Record<string, unknown>;
  const summary = str(ca.call_summary) ?? str(call.call_summary);
  const callOutcome = str(cad.call_outcome);
  const sentiment = str(ca.user_sentiment);

  const costObj = (call.call_cost ?? {}) as { combined_cost?: number };
  const costCents = typeof costObj.combined_cost === "number" ? Math.round(costObj.combined_cost) : null;

  const metadata: Record<string, unknown> = {
    source: "retell_sync",
    retell_call_id: retellId,
    retell_agent_id: str(call.agent_id),
    retell_disconnection_reason: disconnect,
    sentiment,
  };
  // Stamp the Retell business outcome as the qualification so the dashboard's
  // bucketForCall classifies it natively (booked/rappel/pas_interesse/...).
  if (callOutcome) metadata.qualification = callOutcome;

  return {
    retellId,
    costCents,
    row: {
      org_id: orgId,
      direction,
      state,
      from_e164: fromNumber,
      to_e164: toNumber,
      started_at: new Date(startMs).toISOString(),
      answered_at: answered ? new Date(startMs).toISOString() : null,
      ended_at: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
      duration_secs: duration,
      // Fallback disposition for bucketForCall when there's no call_outcome.
      disposition: disconnect,
      recording_url: str(call.recording_url),
      summary,
      metadata,
    },
  };
}

export interface RetellSyncResult {
  fetched: number;
  inserted: number;
  skipped_existing: number;
  skipped_invalid: number;
  cost_events: number;
  error?: string;
}

export async function syncRetellCalls(
  orgId: string,
  opts: { sinceMs?: number; maxCalls?: number } = {},
): Promise<RetellSyncResult> {
  const sinceMs = opts.sinceMs ?? Date.now() - 2 * 86400_000; // default last 2 days
  const maxCalls = Math.min(opts.maxCalls ?? 5000, 50000);
  const sb = supabaseServer();

  const raw = await fetchRetellCallsSince({ sinceMs, maxCalls });
  console.log(`[retell-sync] org=${orgId} since=${new Date(sinceMs).toISOString()} fetched=${raw.length}`);

  // Dedup vs already-synced calls in the window.
  const sinceIso = new Date(sinceMs).toISOString();
  const { data: existing } = await sb
    .from("calls")
    .select("metadata")
    .eq("org_id", orgId)
    .gte("started_at", sinceIso)
    .not("metadata->>retell_call_id", "is", null)
    .limit(50000);
  const known = new Set<string>();
  for (const e of (existing ?? []) as Array<{ metadata: { retell_call_id?: string } | null }>) {
    const id = e.metadata?.retell_call_id;
    if (id) known.add(id);
  }

  let skippedInvalid = 0;
  const seen = new Set<string>();
  const toInsert: CallInsert[] = [];
  const costByRetellId = new Map<string, number>();
  for (const c of raw) {
    const mapped = mapCall(c, orgId);
    if (!mapped) { skippedInvalid += 1; continue; }
    if (known.has(mapped.retellId) || seen.has(mapped.retellId)) continue;
    seen.add(mapped.retellId);
    toInsert.push(mapped.row);
    if (mapped.costCents != null) costByRetellId.set(mapped.retellId, mapped.costCents);
  }

  let inserted = 0;
  let costEvents = 0;
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("calls")
      .insert(chunk)
      .select("id, started_at, metadata");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; started_at: string; metadata: { retell_call_id?: string } | null }>;
    inserted += rows.length;

    // Cost → usage_events, keyed by the freshly minted call id.
    const usageRows = rows
      .map((r) => {
        const rid = r.metadata?.retell_call_id;
        const cents = rid ? costByRetellId.get(rid) : undefined;
        if (cents == null) return null;
        return {
          org_id: orgId,
          event_type: "retell_call",
          quantity: 1,
          cost_cents: cents,
          occurred_at: r.started_at,
          metadata: { call_id: r.id, source: "retell_sync", retell_call_id: rid },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (usageRows.length) {
      const { error: uErr } = await sb.from("usage_events").insert(usageRows);
      if (!uErr) costEvents += usageRows.length;
    }
  }

  const result: RetellSyncResult = {
    fetched: raw.length,
    inserted,
    skipped_existing: raw.length - skippedInvalid - inserted,
    skipped_invalid: skippedInvalid,
    cost_events: costEvents,
  };
  console.log(`[retell-sync] org=${orgId} done`, result);
  return result;
}

/**
 * Upsert a SINGLE Retell call (used by the real-time webhook). Idempotent:
 * inserts if new, updates summary/metadata/duration/disposition if the row
 * already exists (e.g. call_ended then call_analyzed arrive separately).
 * Returns what happened so the webhook can log it.
 */
export async function upsertRetellCall(
  orgId: string,
  rawCall: Record<string, unknown>,
): Promise<{ status: "inserted" | "updated" | "skipped"; call_id?: string; retell_id?: string }> {
  const mapped = mapCall(rawCall, orgId);
  if (!mapped) return { status: "skipped" };
  const sb = supabaseServer();

  // Look for an existing row for this Retell call (org-scoped).
  const { data: existing } = await sb
    .from("calls")
    .select("id")
    .eq("org_id", orgId)
    .eq("metadata->>retell_call_id", mapped.retellId)
    .limit(1)
    .maybeSingle();

  let callId: string;
  if (existing) {
    callId = (existing as { id: string }).id;
    const { error } = await sb.from("calls").update(mapped.row).eq("id", callId);
    if (error) throw new Error(error.message);
  } else {
    const { data: ins, error } = await sb.from("calls").insert(mapped.row).select("id").single();
    if (error) throw new Error(error.message);
    callId = (ins as { id: string }).id;
  }

  // Cost → usage_events, but only once per Retell call.
  if (mapped.costCents != null) {
    const { data: u } = await sb
      .from("usage_events")
      .select("id")
      .eq("org_id", orgId)
      .eq("metadata->>retell_call_id", mapped.retellId)
      .limit(1)
      .maybeSingle();
    if (!u) {
      await sb.from("usage_events").insert({
        org_id: orgId,
        event_type: "retell_call",
        quantity: 1,
        cost_cents: mapped.costCents,
        occurred_at: mapped.row.started_at,
        metadata: { call_id: callId, source: "retell_sync", retell_call_id: mapped.retellId },
      });
    }
  }

  return { status: existing ? "updated" : "inserted", call_id: callId, retell_id: mapped.retellId };
}
