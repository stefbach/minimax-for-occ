/**
 * Phone-number helpers for multi-country geo-routing.
 *
 * Maps ISO 3166-1 alpha-2 country codes to E.164 country prefixes and the
 * reverse lookup (longest-prefix match) used to detect the destination country
 * from a +E.164 number.
 *
 * The table is intentionally small — only the countries we expect to operate
 * in. Extend as needed; keep prefixes in sync with Twilio's CountryCode list.
 *
 * Special cases:
 *  - +1 is shared by US and Canada (NANP). We default countryFromE164('+1...')
 *    to 'US' but `pickFromNumber` will still match any org-owned number whose
 *    country_code is US OR CA via prefix lookup (both rows store prefix '+1').
 */

export interface CountryEntry {
  iso: string; // ISO-2
  prefix: string; // E.164 country prefix, leading '+'
  name: string;
}

// Order matters for longest-prefix-match in countryFromE164: list longer
// prefixes first when they share a leading digit (e.g. +1xxx area codes vs +1).
export const COUNTRIES: readonly CountryEntry[] = [
  { iso: "FR", prefix: "+33", name: "France" },
  { iso: "BE", prefix: "+32", name: "Belgique" },
  { iso: "CH", prefix: "+41", name: "Suisse" },
  { iso: "GB", prefix: "+44", name: "Royaume-Uni" },
  { iso: "DE", prefix: "+49", name: "Allemagne" },
  { iso: "ES", prefix: "+34", name: "Espagne" },
  { iso: "IT", prefix: "+39", name: "Italie" },
  { iso: "NL", prefix: "+31", name: "Pays-Bas" },
  { iso: "PT", prefix: "+351", name: "Portugal" },
  { iso: "IE", prefix: "+353", name: "Irlande" },
  { iso: "LU", prefix: "+352", name: "Luxembourg" },
  { iso: "MU", prefix: "+230", name: "Maurice" },
  // NANP: +1 is shared by US and CA. Resolved to 'US' by default; org-side
  // selection in pickFromNumber matches by prefix, so a CA-tagged number with
  // prefix '+1' will still be picked when the org has no US number.
  { iso: "US", prefix: "+1", name: "États-Unis" },
  { iso: "CA", prefix: "+1", name: "Canada" },
] as const;

const ISO_TO_PREFIX: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of COUNTRIES) {
    // Only the first ISO→prefix wins (which is what we want — explicit list above).
    if (!m[c.iso]) m[c.iso] = c.prefix;
  }
  return m;
})();

// Sorted by descending prefix length so the longest match wins.
const PREFIXES_DESC: readonly CountryEntry[] = [...COUNTRIES].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

/**
 * Return the E.164 country prefix for an ISO-2 code, or null if unknown.
 *   prefixForCountry('FR') -> '+33'
 *   prefixForCountry('zz') -> null
 */
export function prefixForCountry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return ISO_TO_PREFIX[iso.toUpperCase()] ?? null;
}

/**
 * Return the ISO-2 country code for a +E.164 number, or null if unknown.
 *   countryFromE164('+33756123456') -> 'FR'
 *   countryFromE164('+14155551234') -> 'US'  (NANP defaults to US)
 *   countryFromE164('garbage')      -> null
 *
 * Longest-prefix match: '+351...' (Portugal) wins over '+3...' even though
 * no such single-digit prefix exists; the same logic future-proofs additions
 * of multi-digit prefixes like '+44' vs '+447'.
 */
export function countryFromE164(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const v = e164.trim();
  if (!/^\+\d{6,15}$/.test(v)) return null;
  for (const c of PREFIXES_DESC) {
    if (v.startsWith(c.prefix)) return c.iso;
  }
  return null;
}

/**
 * Best-effort prefix from a +E.164 number (without round-tripping through ISO).
 *   prefixFromE164('+33756123456') -> '+33'
 */
export function prefixFromE164(e164: string | null | undefined): string | null {
  const iso = countryFromE164(e164);
  return iso ? prefixForCountry(iso) : null;
}

/**
 * Human-readable name for an ISO-2 country, or the code itself if unknown.
 */
export function countryName(iso: string | null | undefined): string {
  if (!iso) return "—";
  const up = iso.toUpperCase();
  const c = COUNTRIES.find((x) => x.iso === up);
  return c ? c.name : up;
}
