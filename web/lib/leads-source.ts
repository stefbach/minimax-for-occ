import { supabaseServer } from "@/lib/supabase";
import { fetchAllPaged } from "@/lib/supabase-page";

/**
 * Scopes every dashboard KPI to the selected leads source (Prod or Test)
 * WITHOUT mixing the two — see `leadsScopeFor` for the exact, deliberately
 * robust definition.
 *
 * Historical note: the first version defined Prod as "the call's number is in
 * leads_rdv (minus test)". That coupled the dashboard to the *live* contents of
 * leads_rdv — a ~8k-row table OCC's pipeline rewrites continuously. During a
 * re-import the table is briefly partial, so most of the day's calls failed the
 * Prod filter and "Total appels" collapsed (e.g. 410 → 85) until the import
 * finished. It also wrongly dropped real calls placed to numbers not *yet* in
 * leads_rdv.
 *
 * New definition (stable):
 *   Test  = the call's number IS in leads_rdv_test_axon (tiny, stable table).
 *   Prod  = the call's number is NOT in leads_rdv_test_axon (everything else).
 *
 * This is independent of the volatile leads_rdv table, counts every real
 * Retell/Axon call as Prod, and still cleanly keeps sandbox test calls out of
 * Prod (a number listed in BOTH tables counts as Test, never Prod).
 */
export type LeadsSource = "prod" | "test";

// How a call is matched against the selected source. `null` means "no filtering"
// (e.g. the test table is unreadable on a prod scope → keep everything).
export type LeadsScope =
  | { mode: "include"; phones: Set<string> } // call kept iff its number IS in `phones`
  | { mode: "exclude"; phones: Set<string> } // call kept iff its number is NOT in `phones`
  | null;

export function leadsTableFor(source: LeadsSource | null | undefined): string {
  return source === "test" ? "leads_rdv_test_axon" : "leads_rdv";
}

// Every sandbox table whose numbers must stay OUT of the Prod stats. The
// dashboard's Test scope is the union of these; Prod excludes the union.
// leads_rdv_test_megane is the single-lead table used for agent-first /
// latency debugging against Wati's own UK number.
const TEST_TABLES = ["leads_rdv_test_axon", "leads_rdv_test_megane"] as const;

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

export async function leadsScopeFor(
  source: LeadsSource | null | undefined,
): Promise<LeadsScope> {
  // Union of every sandbox table's numbers. A missing table contributes
  // nothing (loadPhoneSet returns null → skipped).
  const sets = await Promise.all(TEST_TABLES.map((t) => loadPhoneSet(t)));
  const test = new Set<string>();
  for (const s of sets) {
    if (!s) continue;
    for (const p of s) test.add(p);
  }
  if (source === "test") {
    // Test = only calls to the sandbox numbers. Empty test tables yield an
    // empty include-set, i.e. the Test view shows nothing (correct).
    return { mode: "include", phones: test };
  }
  // Prod = everything that is NOT a sandbox test call.
  return { mode: "exclude", phones: test };
}

/** Predicate matching a call's to_e164 against the resolved leads scope. Trims
 *  whitespace the same way the loader does so the match is robust. */
export function callInLeadsScope(
  toE164: string | null | undefined,
  scope: LeadsScope,
): boolean {
  if (!scope) return true; // null = no filter
  const norm = normalisePhone(toE164);
  if (scope.mode === "include") return norm ? scope.phones.has(norm) : false;
  // exclude: keep the call unless its number is a known test number. Calls with
  // no destination number (inbound) are kept on the Prod scope.
  return norm ? !scope.phones.has(norm) : true;
}

// Phone → patient name for the selected source. Retell-synced calls carry no
// Axon contact, so the drill-downs and the call-detail view fall back to the
// lead's `nom` here to show a real person instead of a bare number. Best-effort:
// a missing table / column just yields an empty map (callers degrade to phone).
export async function leadNameMapFor(
  source: LeadsSource | null | undefined,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const sb = supabaseServer();
  try {
    const { rows, error } = await fetchAllPaged<{ numero_telephone: string | null; nom: string | null }>(
      () =>
        sb
          .from(leadsTableFor(source) as never)
          .select("numero_telephone, nom")
          .not("numero_telephone", "is", null) as never,
    );
    if (error) return map;
    for (const row of rows) {
      const p = normalisePhone(row.numero_telephone);
      const nom = row.nom?.trim();
      if (p && nom) map.set(p, nom);
    }
  } catch {
    /* table missing — degrade to phone-only */
  }
  return map;
}

// Load phone numbers for every patient in a campaign, using the join:
// campaign_leads.patient_id → leads_rdv.id → leads_rdv.numero_telephone
// Returns a LeadsScope so callInLeadsScope() works directly.
// Returns null (no filter) on unexpected errors so the dashboard doesn't
// go blank — the caller already passed a campaign selection so an empty
// result would be misleading.
export async function campaignScopeFor(
  campaignId: string,
): Promise<LeadsScope> {
  const sb = supabaseServer();
  try {
    const { data: cl } = await (sb
      .from("campaign_leads" as never)
      .select("patient_id")
      .eq("campaign_id" as never, campaignId) as unknown as Promise<{ data: { patient_id: string }[] | null }>);

    const patientIds = (cl ?? []).map((r) => r.patient_id).filter(Boolean);
    if (patientIds.length === 0) return { mode: "include", phones: new Set() };

    const { data: lr } = await (sb
      .from("leads_rdv" as never)
      .select("numero_telephone")
      .in("id" as never, patientIds)
      .not("numero_telephone" as never, "is", null) as unknown as Promise<{ data: { numero_telephone: string | null }[] | null }>);

    const phones = new Set<string>();
    for (const row of lr ?? []) {
      const p = normalisePhone(row.numero_telephone);
      if (p) phones.add(p);
    }
    return { mode: "include", phones };
  } catch {
    return null;
  }
}

/** Look up a single phone in a lead-name map, normalising the same way. */
export function leadNameForPhone(
  phone: string | null | undefined,
  nameMap: Map<string, string>,
): string | null {
  const norm = normalisePhone(phone);
  return norm ? nameMap.get(norm) ?? null : null;
}
