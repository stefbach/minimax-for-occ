/**
 * Geo-routing for outbound calls.
 *
 * Pick the best `from_number` (a phone_numbers row) for an org given the
 * destination E.164:
 *   1. Match by country (country_code derived from to_e164 prefix).
 *   2. Fallback to the org's is_default=true number.
 *   3. Fallback to any active number owned by the org.
 *   4. Throw if the org owns no numbers at all.
 *
 * Only `active` numbers are considered — disabled rows are ignored at every
 * step. The function is read-only and safe to call on every dial.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { countryFromE164 } from "./phone-utils";

export interface PhoneNumberPick {
  id: string;
  org_id: string;
  e164: string;
  label: string | null;
  country_code: string | null;
  prefix: string | null;
  is_default: boolean;
  active: boolean;
}

export class NoPhoneNumberError extends Error {
  constructor(orgId: string) {
    super(
      `No active phone_numbers row available for org ${orgId}. ` +
        "Provision at least one Twilio number in the Numéros UI.",
    );
    this.name = "NoPhoneNumberError";
  }
}

const SELECT_COLS =
  "id, org_id, e164, label, country_code, prefix, is_default, active";

/**
 * Pick a phone_numbers row to use as the From number for an outbound call.
 *
 * @param sb     Supabase server client (service-role recommended).
 * @param orgId  Org owning the calling agent.
 * @param toE164 Destination in +E.164 format.
 * @returns      The chosen phone_numbers row.
 * @throws       NoPhoneNumberError if the org has no active numbers at all.
 */
export async function pickFromNumber(
  sb: SupabaseClient,
  orgId: string,
  toE164: string,
): Promise<PhoneNumberPick> {
  // Step 1 — country match.
  const iso = countryFromE164(toE164);
  if (iso) {
    const { data, error } = await sb
      .from("phone_numbers")
      .select(SELECT_COLS)
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("country_code", iso)
      // Prefer the org default if multiple numbers exist in that country.
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return data[0] as PhoneNumberPick;
  }

  // Step 2 — org default.
  {
    const { data, error } = await sb
      .from("phone_numbers")
      .select(SELECT_COLS)
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("is_default", true)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return data[0] as PhoneNumberPick;
  }

  // Step 3 — any active number owned by the org.
  {
    const { data, error } = await sb
      .from("phone_numbers")
      .select(SELECT_COLS)
      .eq("org_id", orgId)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return data[0] as PhoneNumberPick;
  }

  // Step 4 — give up.
  throw new NoPhoneNumberError(orgId);
}
