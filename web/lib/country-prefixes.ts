// E.164 → country lookup for the human softphone (CountryPrefix selector
// + auto-flag chip beside lead numbers). Ordered by OCC's call volume:
// UK first (the prospection target), then Mauritius (operator home),
// then France (former campaigns), then a small EU/global set so the
// dialer is useful for any one-off call. Keep the list focused — we add
// rows only when a tenant actually needs them.

export interface CountryEntry {
  code: string;       // ISO 3166-1 alpha-2
  prefix: string;     // E.164 prefix WITH leading + (e.g. "+44")
  name: string;       // Display name in French
  flag: string;       // Unicode flag emoji
}

export const COUNTRIES: CountryEntry[] = [
  { code: "GB", prefix: "+44",  name: "Royaume-Uni", flag: "🇬🇧" },
  { code: "MU", prefix: "+230", name: "Maurice",     flag: "🇲🇺" },
  { code: "FR", prefix: "+33",  name: "France",      flag: "🇫🇷" },
  { code: "US", prefix: "+1",   name: "USA / Canada", flag: "🇺🇸" },
  { code: "IE", prefix: "+353", name: "Irlande",     flag: "🇮🇪" },
  { code: "DE", prefix: "+49",  name: "Allemagne",   flag: "🇩🇪" },
  { code: "ES", prefix: "+34",  name: "Espagne",     flag: "🇪🇸" },
  { code: "IT", prefix: "+39",  name: "Italie",      flag: "🇮🇹" },
  { code: "BE", prefix: "+32",  name: "Belgique",    flag: "🇧🇪" },
  { code: "NL", prefix: "+31",  name: "Pays-Bas",    flag: "🇳🇱" },
  { code: "CH", prefix: "+41",  name: "Suisse",      flag: "🇨🇭" },
  { code: "PT", prefix: "+351", name: "Portugal",    flag: "🇵🇹" },
  { code: "ZA", prefix: "+27",  name: "Afrique du Sud", flag: "🇿🇦" },
  { code: "AU", prefix: "+61",  name: "Australie",   flag: "🇦🇺" },
  { code: "IN", prefix: "+91",  name: "Inde",        flag: "🇮🇳" },
];

/** Best-effort country lookup from a partial E.164. Returns null on no
 *  match (e.g. caller typed a digit before the leading +). */
export function countryFor(e164: string): CountryEntry | null {
  const trimmed = e164.trim();
  if (!trimmed.startsWith("+")) return null;
  // Sort longest prefix first so "+1" doesn't shadow "+1242".
  const sorted = [...COUNTRIES].sort((a, b) => b.prefix.length - a.prefix.length);
  return sorted.find((c) => trimmed.startsWith(c.prefix)) ?? null;
}

/** Human label "🇬🇧 Royaume-Uni" or empty string. */
export function countryFromE164(e164: string): string {
  const c = countryFor(e164);
  return c ? `${c.flag} ${c.name}` : "";
}

/** Just the flag emoji — used by tables / inline rows. */
export function flagFromE164(e164: string): string {
  return countryFor(e164)?.flag ?? "🏳";
}
