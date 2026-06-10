// A "real" call is one the telephony provider actually placed: a Retell-synced
// call (source=retell_sync) or a Twilio call (it carries a twilio_call_sid).
//
// The LiveKit agent path, however, sometimes creates `calls` rows that never
// connect to a Twilio leg — failed/aborted dispatches with no twilio_call_sid,
// no answer and 0 duration. They are pure artifacts (observed ~100/day) and
// must not inflate the dashboard counts. This predicate flags them so every
// aggregation can drop them centrally.

export function isPhantomCall(row: {
  answered_at?: string | null;
  duration_secs?: number | null;
  metadata?: { source?: string; twilio_call_sid?: string } | Record<string, unknown> | null;
}): boolean {
  const m = (row.metadata ?? {}) as { source?: string; twilio_call_sid?: string };
  // Anything the provider really handled is never a phantom.
  if (m.source === "retell_sync") return false;
  if (m.twilio_call_sid) return false;
  // Otherwise it's only a phantom if it never became a real call.
  return !row.answered_at && (row.duration_secs ?? 0) === 0;
}
