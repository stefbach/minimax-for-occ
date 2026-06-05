import { supabaseServer } from "@/lib/supabase";
import { fetchAllPaged } from "@/lib/supabase-page";

/**
 * Returns the set of phone numbers that belong to the selected leads source,
 * used by every dashboard endpoint to scope KPIs (total, cost, qualifications,
 * durations, drill-downs, call logs, live) to that source.
 *
 * Prod and Test must NEVER mix. A test number can legitimately ALSO live in
 * the prod table (e.g. the dev's own phone). To keep the two sources cleanly
 * separated we define:
 *
 *   Test  = phones in leads_rdv_test_axon
 *   Prod  = phones in leads_rdv  EXCEPT any that are also in the test table
 *
 * Without the subtraction, an Axon test call placed to a number that's in both
 * tables would be counted under Prod and inflate the production figures (the
 * "415 instead of 410" symptom).
 *
 * Returns `null` when the selected table doesn't exist, so callers can skip
 * filtering instead of returning an empty set.
 *
 * Normalises by stripping whitespace because the source CSV had values like
 * "+230 5748 0009" that wouldn't match the E.164 stored in calls.to_e164.
 */
export type LeadsSource = "prod" | "test";

export function leadsTableFor(source: LeadsSource | null | undefined): string {
  return source === "test" ? "leads_rdv_test_axon" : "leads_rdv";
}

function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = String(raw).replace(/\s+/g, "");
  return stripped || null;
}

// Load every phone of one physical table, paged past the 1000-row cap.
// Returns null when the table is missing / unreadable.
async function loadPhoneSet(table: string): Promise<Set<string> | null> {
  const sb = supabaseServer();
  try {
    const { rows, error } = await fetchAllPaged<{ numero_telephone: string | null }>(
      () =>
        sb
          .from(table as never)
          .select("numero_telephone")
          .not("numero_telephone", "is", null),
    );
    if (error) return null;
    const set = new Set<string>();
    for (const row of rows) {
      const p = normalisePhone(row.numero_telephone);
      if (p) set.add(p);
    }
    return set;
  } catch {
    return null;
  }
}

export async function phoneSetForLeadsSource(
  source: LeadsSource | null | undefined,
): Promise<Set<string> | null> {
  if (source === "test") {
    return loadPhoneSet(leadsTableFor("test"));
  }
  // Prod = prod phones minus any that are also test numbers, so test calls
  // never leak into the production figures.
  const prod = await loadPhoneSet(leadsTableFor("prod"));
  if (!prod) return null;
  const test = await loadPhoneSet(leadsTableFor("test"));
  if (test) for (const p of test) prod.delete(p);
  return prod;
}

/** Predicate matching a call's to_e164 against the leads phone set. Trims
 *  whitespace the same way the loader does so the match is robust. */
export function callBelongsToLeadsSource(
  toE164: string | null | undefined,
  phoneSet: Set<string> | null,
): boolean {
  if (!phoneSet) return true; // null = no filter (e.g. tenant has no leads table)
  const norm = normalisePhone(toE164);
  if (!norm) return false;
  return phoneSet.has(norm);
}
