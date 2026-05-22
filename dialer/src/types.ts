/**
 * Shared dialer-side row types.
 *
 * Supabase's TypeScript client returns `unknown`-ish row shapes for ad-hoc
 * `select(...)` queries. Rather than scattering `as any` casts through dial.ts,
 * we declare the exact subset of columns we query and parse incoming rows once
 * via the small helpers at the bottom of this file.
 *
 * Keep these in sync with supabase/migrations/* and web/lib/types.ts.
 */

export interface ContactRow {
  id?: string;
  e164: string | null;
  display_name?: string | null;
}

/**
 * Row returned by select(
 *   "id,campaign_id,contact_id,status,attempts,contacts(e164,display_name)"
 * ) on campaign_targets.
 *
 * Note: PostgREST embeds a 1:1 relation as an object (or null when not found),
 * but the generated typings often widen this to `unknown[] | unknown`. We
 * normalise it to a single `ContactRow | null` via `parseContact()` below.
 */
export interface DialTargetRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: string;
  attempts: number | null;
  contacts: ContactRow | ContactRow[] | null;
}

export interface DialCampaignRow {
  id: string;
  org_id: string;
  state: string;
  phone_number_id: string | null;
  caller_id_e164: string | null;
  amd_enabled: boolean | null;
  max_attempts: number | null;
  retry_delay_min: number | null;
}

/**
 * Normalise the embedded `contacts` field to a single ContactRow (or null).
 * Supabase returns an object for a single relation and an array if the join
 * resolves to many — defend against both.
 */
export function parseContact(
  contacts: ContactRow | ContactRow[] | null | undefined,
): ContactRow | null {
  if (!contacts) return null;
  if (Array.isArray(contacts)) return contacts[0] ?? null;
  return contacts;
}

/**
 * Best-effort row picker that strips any extra unknown columns Supabase might
 * return. Used to convert the loosely-typed `single()` payload into our
 * `DialTargetRow` shape without a blanket `as any`.
 */
export function toDialTargetRow(row: Record<string, unknown>): DialTargetRow {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    contact_id: String(row.contact_id),
    status: String(row.status),
    attempts: typeof row.attempts === "number" ? row.attempts : null,
    contacts: (row.contacts ?? null) as ContactRow | ContactRow[] | null,
  };
}

export function toDialCampaignRow(row: Record<string, unknown>): DialCampaignRow {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    state: String(row.state),
    phone_number_id:
      typeof row.phone_number_id === "string" ? row.phone_number_id : null,
    caller_id_e164:
      typeof row.caller_id_e164 === "string" ? row.caller_id_e164 : null,
    amd_enabled: typeof row.amd_enabled === "boolean" ? row.amd_enabled : null,
    max_attempts: typeof row.max_attempts === "number" ? row.max_attempts : null,
    retry_delay_min:
      typeof row.retry_delay_min === "number" ? row.retry_delay_min : null,
  };
}
