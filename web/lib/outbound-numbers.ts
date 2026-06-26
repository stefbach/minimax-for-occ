/**
 * Per-agent OUTBOUND caller-ID resolution (Wati 25/06).
 *
 * A human agent may only place outbound calls from a number that has been
 * assigned to them (table `outbound_number_agents`). This is the single source
 * of truth used by every outbound path so the restriction can't be bypassed:
 *   - /api/desk/caller-id        → what the softphone offers / displays
 *   - /api/desk/dial             → LiveKit SIP / Twilio REST originate
 *   - /api/twilio/voice-outbound → browser Twilio Voice SDK <Dial callerId>
 *
 * Policy (Wati's choices):
 *   - An agent may have SEVERAL assigned numbers and pick one; `is_primary`
 *     is the default.
 *   - An agent with NO assignment falls back to the org default (geo-routing).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickFromNumber, NoPhoneNumberError } from "@/lib/geo-routing";

export interface AssignedOutboundNumber {
  id: string;
  e164: string;
  label: string | null;
  is_primary: boolean;
}

/**
 * The outbound numbers assigned to a user, joined to phone_numbers for their
 * e164 / label. Primary first, then alphabetical. Empty array = no assignment.
 */
export async function getAssignedOutboundNumbers(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<AssignedOutboundNumber[]> {
  // Two queries (no FK embed) — mirrors the inbound_number_agents pattern and
  // avoids depending on a PostgREST relationship that isn't declared.
  const { data: assigns } = await admin
    .from("outbound_number_agents")
    .select("phone_number_id, is_primary")
    .eq("org_id", orgId)
    .eq("user_id", userId);
  const rows = (assigns ?? []) as Array<{ phone_number_id: string; is_primary: boolean | null }>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.phone_number_id);
  const { data: nums } = await admin
    .from("phone_numbers")
    .select("id, e164, label, active")
    .eq("org_id", orgId)
    .in("id", ids);
  const numById = new Map(
    ((nums ?? []) as Array<{ id: string; e164: string; label: string | null; active: boolean | null }>).map(
      (n) => [n.id, n],
    ),
  );

  return rows
    .map((r) => {
      const n = numById.get(r.phone_number_id);
      // Only numbers that still exist and are active are usable as a caller-ID.
      if (!n || n.active === false || !n.e164) return null;
      return { id: n.id, e164: n.e164, label: n.label, is_primary: !!r.is_primary };
    })
    .filter((x): x is AssignedOutboundNumber => x !== null)
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.e164.localeCompare(b.e164);
    });
}

export interface ResolvedFrom {
  e164: string;
  /** How it was chosen — useful for logs / debugging. */
  source: "assigned-requested" | "assigned-primary" | "org-default";
}

/**
 * Resolve the From caller-ID for an outbound call by `userId`, enforcing the
 * per-agent assignment:
 *   1. If the agent has assigned numbers and `requestedE164` is one of them → use it.
 *   2. Else if the agent has assigned numbers → use their primary (or first).
 *   3. Else (no assignment) → org default via geo-routing on `toE164`.
 *
 * Throws NoPhoneNumberError only in case 3 when the org owns no usable number.
 */
export async function resolveOutboundFrom(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  toE164: string,
  requestedE164?: string | null,
): Promise<ResolvedFrom> {
  const assigned = await getAssignedOutboundNumbers(admin, orgId, userId);
  if (assigned.length > 0) {
    const req = (requestedE164 ?? "").trim();
    if (req) {
      const match = assigned.find((n) => n.e164 === req);
      if (match) return { e164: match.e164, source: "assigned-requested" };
      // Requested a number that's NOT theirs — ignore it, use their default.
      // (Restriction: an agent can never dial out on an unassigned number.)
    }
    const primary = assigned.find((n) => n.is_primary) ?? assigned[0];
    return { e164: primary.e164, source: "assigned-primary" };
  }
  // No assignment → org default (geo-routing). Propagates NoPhoneNumberError.
  const picked = await pickFromNumber(admin, orgId, toE164);
  return { e164: picked.e164, source: "org-default" };
}

export { NoPhoneNumberError };
