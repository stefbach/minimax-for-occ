// A "real" call is one the telephony provider actually placed: a Retell-synced
// call (source=retell_sync) or a Twilio call (it carries a twilio_call_sid).
//
// The LiveKit agent path, however, sometimes creates `calls` rows that never
// connect to a Twilio leg — failed/aborted dispatches with no twilio_call_sid,
// no answer and 0 duration. They are pure artifacts (observed ~100/day) and
// must not inflate the dashboard counts. This predicate flags them so every
// aggregation can drop them centrally.
//
// A second class of artifact comes from the LiveKit ↔ Twilio SIP trunk: the
// reconciliation sync logs the *transport* leg of a call (Twilio dialing into
// LiveKit's SIP endpoint, or vice-versa) as its own `calls` row. These carry a
// real twilio_call_sid but their counterparty is either empty or OCC's OWN
// number — never a patient — so they show up as "Unknown / —" duplicates of the
// real call. `isInternalLeg` flags them; `isPhantomCall` folds it in.

import { cleanPhone } from "./phone-clean";

// OCC's own DID(s) — the Twilio caller-ID. A call whose counterparty is one of
// these isn't patient-facing, it's a trunk transport leg. Override via env when
// the account's numbers change.
const OWN_NUMBERS = new Set(
  (process.env.OCC_OWN_NUMBERS ?? "+447888861445")
    .split(",")
    .map((s) => cleanPhone(s.trim()))
    .filter((s): s is string => !!s),
);

type CallShape = {
  direction?: string | null;
  from_e164?: string | null;
  to_e164?: string | null;
  answered_at?: string | null;
  duration_secs?: number | null;
  metadata?: { source?: string; twilio_call_sid?: string } | Record<string, unknown> | null;
};

// True when a row is an internal SIP-trunk transport leg rather than a real
// patient call: its displayed counterparty (to for outbound, from for inbound)
// is missing or is one of OCC's own numbers. Guarded by `in` checks so callers
// that didn't SELECT the phone/direction columns are never mis-flagged.
export function isInternalLeg(row: CallShape): boolean {
  const dir = (row.direction ?? "") as string;
  const inbound = dir === "in" || dir === "inbound";
  const key = inbound ? "from_e164" : "to_e164";
  if (!(key in row)) return false; // counterparty not loaded → can't judge
  const cp = cleanPhone(row[key as "from_e164" | "to_e164"]);
  return !cp || OWN_NUMBERS.has(cp);
}

export function isPhantomCall(row: CallShape): boolean {
  const m = (row.metadata ?? {}) as { source?: string; twilio_call_sid?: string };
  // Internal trunk transport leg (no real patient counterparty) — always an
  // artifact, even with a twilio_call_sid.
  if (isInternalLeg(row)) return true;
  // Anything the provider really handled is never a phantom.
  if (m.source === "retell_sync") return false;
  if (m.twilio_call_sid) return false;
  // Otherwise it's only a phantom if it never became a real call.
  return !row.answered_at && (row.duration_secs ?? 0) === 0;
}
