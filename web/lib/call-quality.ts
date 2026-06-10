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

/**
 * /desk softphone test calls create TWO rows per call:
 *  - the OUTBOUND row (direction=out, to_e164=+44..., agent_handle_id set)
 *  - the INBOUND row written by twilio_sync with from_e164='client:user-<uuid>'
 *    (Twilio sees the softphone browser session as a SIP client). That second
 *    row has no real conversation — it's the same call's Twilio-side leg.
 *
 * We keep the outbound row (it's the human-agent-driven call) and skip the
 * inbound leg so it doesn't inflate the dashboard 'AUTRE' bucket. Wati's
 * June 10 review caught these as bogus "PAS DE REPONSE" entries.
 */
export function isSoftphoneTestLeg(row: {
  direction?: string | null;
  from_e164?: string | null;
  metadata?: { source?: string } | Record<string, unknown> | null;
}): boolean {
  if (row.direction !== "in") return false;
  const from = row.from_e164 ?? "";
  if (!from.toLowerCase().startsWith("client:user-")) return false;
  const m = (row.metadata ?? {}) as { source?: string };
  return m.source === "twilio_sync";
}
