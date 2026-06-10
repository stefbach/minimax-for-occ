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

  for (const c of calls) {
    const sid = str(c.sid);
    if (!sid) { skippedInvalid += 1; continue; }
    const startMs = c.start_time ? Date.parse(c.start_time) : NaN;
    if (!Number.isFinite(startMs)) { skippedInvalid += 1; continue; }

    const state = mapState(c.status);
    const duration = Number(c.duration) || 0;
    const answeredBy = (c.answered_by ?? "").toLowerCase();
    const isVoicemail = answeredBy.startsWith("machine_");
    const answered = c.status === "completed" && duration >= 15 && !isVoicemail;
    const direction: "in" | "out" = (c.direction ?? "").startsWith("inbound") ? "in" : "out";

    const row = existing.get(sid);
    if (row) {
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

    // New call the webhook never recorded → insert a full row.
    toInsert.push({
      org_id: orgId,
      direction,
      state,
      from_e164: str(c.from),
      to_e164: str(c.to),
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
  }

  const result: TwilioSyncResult = {
    fetched: raw.length,
    inserted,
    reconciled,
    skipped_existing: skippedExisting,
    skipped_invalid: skippedInvalid,
  };
  console.log(`[twilio-sync] org=${orgId} done`, result);
  return result;
}
