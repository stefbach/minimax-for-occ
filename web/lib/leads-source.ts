import { supabaseServer } from "@/lib/supabase";

/**
 * Returns the set of phone numbers (numero_telephone) that belong to the
 * selected leads table. Used by the dashboard endpoints to scope EVERY
 * KPI — total calls, costs, qualifications, durations — to calls actually
 * made to leads from that table. Without it, the Prod/Test toggle would
 * only flip the J1/J3/J5 phase widget and the source attribution table,
 * which made operators think the toggle "did nothing".
 *
 * Returns `null` when the selected table doesn't exist, so callers can
 * skip filtering instead of accidentally returning an empty result set.
 *
 * Normalises by stripping whitespace because OCC's source CSV had values
 * like "+230 5748 0009" with embedded spaces that wouldn't match the
 * E.164 stored in calls.to_e164 otherwise.
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

export async function phoneSetForLeadsSource(
  source: LeadsSource | null | undefined,
): Promise<Set<string> | null> {
  const table = leadsTableFor(source);
  const sb = supabaseServer();
  try {
    const { data, error } = await sb
      .from(table as never)
      .select("numero_telephone")
      .not("numero_telephone", "is", null)
      .limit(50000);
    if (error || !Array.isArray(data)) return null;
    const set = new Set<string>();
    for (const row of data as Array<{ numero_telephone: string | null }>) {
      const p = normalisePhone(row.numero_telephone);
      if (p) set.add(p);
    }
    return set;
  } catch {
    return null;
  }
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
