// Global dashboard filters — the OCC legacy dashboard's filter bar (Durée /
// Qualification / Source / Agent / Tentative / Éligibilité / Décroché +
// recherche libre) ported to Axon. One module shared by the PeriodBar UI,
// the tab components (query-string building) and the dashboard API routes
// (row matching), so the semantics can never drift between client and server.
//
// All fields default to "no constraint": empty arrays / "all" / "". Routes
// that receive no gf_* params behave exactly as before this feature landed.

import type { QualBucket } from "@/lib/qualification";

export type AttemptFilter = "all" | "1" | "2" | "3plus";
export type EligibilityFilter = "all" | "eligible" | "ineligible" | "unknown";
// Per-call eligibility resolved from the leads table (S2 rule: BMI ≥ 40 —
// mirrors the eligibility pipeline in /api/dashboard/analytics).
export type EligibilityState = "eligible" | "ineligible" | "unknown";
export type AnsweredGlobalFilter = "all" | "yes" | "no";

export type GlobalFilters = {
  durations: string[]; // GLOBAL_DURATION_BUCKETS ids — OR'd together
  quals: QualBucket[]; // OR'd together
  sources: string[]; // lead source_lead values — OR'd together
  agents: string[]; // agent display names — OR'd together
  attempt: AttemptFilter;
  eligibility: EligibilityFilter;
  answered: AnsweredGlobalFilter;
  q: string; // free text over name / phone / summary
};

export const DEFAULT_GLOBAL_FILTERS: GlobalFilters = {
  durations: [],
  quals: [],
  sources: [],
  agents: [],
  attempt: "all",
  eligibility: "all",
  answered: "all",
  q: "",
};

export const GLOBAL_DURATION_BUCKETS: { id: string; label: string; min: number; max: number }[] = [
  { id: "d0_30", label: "0–30s", min: 0, max: 30 },
  { id: "d30_60", label: "30–60s", min: 30, max: 60 },
  { id: "d60_120", label: "1–2 min", min: 60, max: 120 },
  { id: "d120_300", label: "2–5 min", min: 120, max: 300 },
  { id: "d300_600", label: "5–10 min", min: 300, max: 600 },
  { id: "d600p", label: "10 min+", min: 600, max: Infinity },
];

const QUAL_KEYS = new Set<string>([
  "rdv_confirme", "passer_humain", "rappel", "pas_interesse", "pas_de_reponse",
  "repondeur", "faux_numero", "non_eligible", "ne_pas_rappeler", "autre",
]);

function csv(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Parse from any param accessor (URLSearchParams.get, or a POST body lookup).
export function parseGlobalFilters(get: (key: string) => string | null): GlobalFilters {
  const durIds = new Set(GLOBAL_DURATION_BUCKETS.map((b) => b.id));
  const attempt = get("gf_attempt");
  const elig = get("gf_elig");
  const answered = get("gf_answered");
  return {
    durations: csv(get("gf_dur")).filter((d) => durIds.has(d)),
    quals: csv(get("gf_qual")).filter((q) => QUAL_KEYS.has(q)) as QualBucket[],
    sources: csv(get("gf_src")),
    agents: csv(get("gf_agent")),
    attempt: attempt === "1" || attempt === "2" || attempt === "3plus" ? attempt : "all",
    eligibility:
      elig === "eligible" || elig === "ineligible" || elig === "unknown" ? elig : "all",
    answered: answered === "yes" || answered === "no" ? answered : "all",
    q: (get("gf_q") ?? "").trim(),
  };
}

// Only non-default values are emitted, so untouched filters add zero params.
export function globalFilterParams(f: GlobalFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.durations.length) p.gf_dur = f.durations.join(",");
  if (f.quals.length) p.gf_qual = f.quals.join(",");
  if (f.sources.length) p.gf_src = f.sources.join(",");
  if (f.agents.length) p.gf_agent = f.agents.join(",");
  if (f.attempt !== "all") p.gf_attempt = f.attempt;
  if (f.eligibility !== "all") p.gf_elig = f.eligibility;
  if (f.answered !== "all") p.gf_answered = f.answered;
  if (f.q) p.gf_q = f.q;
  return p;
}

export function appendGlobalFilters(qs: URLSearchParams, f: GlobalFilters): void {
  for (const [k, v] of Object.entries(globalFilterParams(f))) qs.set(k, v);
}

// Stable string for useEffect dependency arrays.
export function globalFiltersKey(f: GlobalFilters): string {
  return JSON.stringify(globalFilterParams(f));
}

export function hasActiveGlobalFilters(f: GlobalFilters): boolean {
  return Object.keys(globalFilterParams(f)).length > 0;
}

// Filters that need leads-table context (BMI, source, attempt counts) and are
// therefore only honoured by the server-computed tabs (Vue d'ensemble,
// Statistiques). The Call Logs tab applies the rest client-side and shows a
// note when one of these is active.
export function hasLeadScopedFilters(f: GlobalFilters): boolean {
  return f.sources.length > 0 || f.attempt !== "all" || f.eligibility !== "all";
}

// Everything the matcher needs to know about one call, resolved by the route
// (each route joins leads/contacts differently, so resolution stays local).
export type GlobalCallCtx = {
  durationSecs: number;
  bucket: QualBucket;
  agent: string | null;
  answered: boolean;
  attempt: number | null; // 1-based attempt index for this phone; null = unknown
  eligibility: EligibilityState;
  source: string | null;
  haystack: string; // pre-lowercased searchable text (name + phone + summary)
};

export function matchesGlobalFilters(f: GlobalFilters, c: GlobalCallCtx): boolean {
  if (f.durations.length) {
    const ok = f.durations.some((id) => {
      const b = GLOBAL_DURATION_BUCKETS.find((x) => x.id === id);
      return b ? c.durationSecs >= b.min && c.durationSecs < b.max : false;
    });
    if (!ok) return false;
  }
  if (f.quals.length && !f.quals.includes(c.bucket)) return false;
  if (f.sources.length && !f.sources.includes((c.source ?? "Inconnue").trim() || "Inconnue")) return false;
  if (f.agents.length && (!c.agent || !f.agents.includes(c.agent))) return false;
  if (f.attempt !== "all") {
    if (c.attempt == null) return false;
    if (f.attempt === "1" && c.attempt !== 1) return false;
    if (f.attempt === "2" && c.attempt !== 2) return false;
    if (f.attempt === "3plus" && c.attempt < 3) return false;
  }
  if (f.eligibility !== "all" && c.eligibility !== f.eligibility) return false;
  if (f.answered === "yes" && !c.answered) return false;
  if (f.answered === "no" && c.answered) return false;
  if (f.q) {
    const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.every((t) => c.haystack.includes(t))) return false;
  }
  return true;
}

// ── Server-side lead context (BMI / source / name by phone) ────────────────
// Built once per request by routes that honour the lead-scoped filters.

export type LeadFilterIndex = {
  bmiByPhone: Map<string, number>;
  sourceByPhone: Map<string, string>;
  nameByPhone: Map<string, string>;
  available: boolean; // false when the tenant has no leads table
};

export const EMPTY_LEAD_INDEX: LeadFilterIndex = {
  bmiByPhone: new Map(),
  sourceByPhone: new Map(),
  nameByPhone: new Map(),
  available: false,
};

export function buildLeadFilterIndex(
  leads: { nom?: string | null; numero_telephone?: string | null; source_lead?: string | null; bmi?: number | null }[],
): LeadFilterIndex {
  const idx: LeadFilterIndex = {
    bmiByPhone: new Map(),
    sourceByPhone: new Map(),
    nameByPhone: new Map(),
    available: true,
  };
  for (const l of leads) {
    const phone = l.numero_telephone;
    if (!phone) continue;
    const bmi = Number(l.bmi);
    if (Number.isFinite(bmi)) idx.bmiByPhone.set(phone, bmi);
    idx.sourceByPhone.set(phone, (l.source_lead || "Inconnue").trim() || "Inconnue");
    if (l.nom) idx.nameByPhone.set(phone, l.nom);
  }
  return idx;
}

export function eligibilityForPhone(phone: string | null, idx: LeadFilterIndex): EligibilityState {
  if (!phone || !idx.available) return "unknown";
  const bmi = idx.bmiByPhone.get(phone);
  if (bmi == null) return "unknown";
  return bmi >= 40 ? "eligible" : "ineligible";
}

// 1-based attempt index per called number, in chronological order over the
// supplied rows (the analysed period). Calls without a number get null.
export function buildAttemptIndex<T extends { id: string; to_e164: string | null; started_at: string | null }>(
  rows: T[],
): Map<string, number> {
  const sorted = [...rows].sort((a, b) =>
    (a.started_at ?? "").localeCompare(b.started_at ?? ""),
  );
  const perPhone = new Map<string, number>();
  const byCallId = new Map<string, number>();
  for (const r of sorted) {
    if (!r.to_e164) continue;
    const n = (perPhone.get(r.to_e164) ?? 0) + 1;
    perPhone.set(r.to_e164, n);
    byCallId.set(r.id, n);
  }
  return byCallId;
}
