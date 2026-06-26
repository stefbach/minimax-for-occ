"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { QUAL_BUCKETS } from "@/lib/qualification";
import {
  DEFAULT_GLOBAL_FILTERS,
  GLOBAL_DURATION_BUCKETS,
  type GlobalFilters,
} from "@/lib/global-filters";
import type { FilterOptionsResponse } from "@/app/api/dashboard/filter-options/route";

export type Period = { from: string; to: string; preset: string };
// The bar's state = the legacy global filters (durée / qualification / source
// / agent / tentative / éligibilité / décroché / recherche) + the Axon axes.
export type Filters = GlobalFilters & {
  direction: "all" | "inbound" | "outbound";
  // Picks which leads table the dashboard summarises for the J1/J3/J5
  // phase counts and the source-attribution breakdown. Production is the
  // default; switching to 'test' lets the operator validate new flows
  // without polluting OCC's real numbers.
  leadsSource: "prod" | "test";
  // Calling-system axis (orthogonal to leadsSource): show calls from Retell,
  // from Axon, or both. Useful during the Retell→Axon migration.
  system: "all" | "retell" | "axon";
  // Calling slot: OCC's prospection cadence has three discrete windows
  // each weekday. The filter post-restricts the period to calls whose
  // started_at falls inside the slot (UK BST). 'all' = no slot filter.
  //   matin       = 08:00-11:00 UK = 07:00-10:00 UTC
  //   après-midi  = 13:00-14:00 UK = 12:00-13:00 UTC
  //   soir        = 18:00-20:00 UK = 17:00-19:00 UTC
  slot: "all" | "morning" | "afternoon" | "evening";
  // Campaign filter: "all" means no filter, otherwise a campaign UUID
  campaignId: string;
};

export const DEFAULT_FILTERS: Filters = {
  ...DEFAULT_GLOBAL_FILTERS,
  direction: "all",
  leadsSource: "prod",
  system: "all",
  slot: "all",
  campaignId: "all",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function presetToRange(preset: string): { from: string; to: string } {
  const now = new Date();
  // Specific calendar day picked from the date input: "date:YYYY-MM-DD".
  if (preset.startsWith("date:")) {
    const d = new Date(`${preset.slice(5)}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return { from: startOfDay(d).toISOString(), to: endOfDay(d).toISOString() };
    }
  }
  // Date interval picked from the Du/Au inputs: "range:YYYY-MM-DD:YYYY-MM-DD"
  // (dates use '-', so splitting on ':' is unambiguous).
  if (preset.startsWith("range:")) {
    const [, f, t2] = preset.split(":");
    const df = new Date(`${f}T00:00:00`);
    const dt = new Date(`${t2}T00:00:00`);
    if (!Number.isNaN(df.getTime()) && !Number.isNaN(dt.getTime())) {
      return { from: startOfDay(df).toISOString(), to: endOfDay(dt).toISOString() };
    }
  }
  switch (preset) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: now.toISOString() };
    case "yesterday": {
      const y = new Date(now.getTime() - 86400_000);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
    }
    case "7d":
      return { from: startOfDay(new Date(now.getTime() - 6 * 86400_000)).toISOString(), to: now.toISOString() };
    case "30d":
      return { from: startOfDay(new Date(now.getTime() - 29 * 86400_000)).toISOString(), to: now.toISOString() };
    case "all":
      return { from: new Date("2020-01-01").toISOString(), to: now.toISOString() };
    default:
      return { from: startOfDay(new Date(now.getTime() - 6 * 86400_000)).toISOString(), to: now.toISOString() };
  }
}

const PRESETS: { id: string; label: string }[] = [
  { id: "today", label: "Aujourd'hui" },
  { id: "yesterday", label: "Hier" },
  { id: "7d", label: "7 derniers j" },
  { id: "30d", label: "30 derniers j" },
  { id: "all", label: "Tout" },
];

// Compact multi-select dropdown (checkbox list inside a <details> popover).
// Native <details> keeps it dependency-free; an outside-click listener closes
// any open popover so the bar behaves like the legacy dashboard's menus.
function MultiDrop({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const active = selected.length > 0;
  return (
    <details ref={ref} style={{ position: "relative" }}>
      <summary
        className={active ? "" : "ghost"}
        style={{
          listStyle: "none", cursor: "pointer", padding: "5px 11px", fontSize: 13,
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 6, userSelect: "none", whiteSpace: "nowrap",
          background: active ? "var(--accent)" : "transparent",
          color: active ? "white" : "var(--text)",
        }}
      >
        {label}
        {active ? ` · ${selected.length}` : ""} <span style={{ fontSize: 10 }}>▾</span>
      </summary>
      <div
        className="card"
        style={{
          position: "absolute", zIndex: 40, top: "calc(100% + 4px)", left: 0,
          minWidth: 200, maxHeight: 260, overflowY: "auto", padding: 8,
          display: "flex", flexDirection: "column", gap: 2,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        {options.length === 0 && (
          <span className="muted" style={{ fontSize: 12, padding: "4px 6px" }}>—</span>
        )}
        {options.map((o) => (
          <label
            key={o.value}
            style={{
              display: "flex", alignItems: "center", gap: 8, fontSize: 13,
              padding: "4px 6px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => toggle(o.value)}
              style={{ width: "auto" }}
            />
            {o.label}
          </label>
        ))}
        {active && (
          <button
            type="button"
            className="ghost"
            onClick={() => onChange([])}
            style={{ marginTop: 4, padding: "3px 8px", fontSize: 12 }}
          >
            ✕
          </button>
        )}
      </div>
    </details>
  );
}

// Single-choice sibling of MultiDrop — same button + popover look, but picks
// one value and closes on selection. "all" counts as inactive (no highlight).
function SingleDrop({
  label,
  options,
  value,
  onChange,
  title,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const active = value !== "all";
  const current = options.find((o) => o.value === value);
  return (
    <details ref={ref} style={{ position: "relative" }}>
      <summary
        className={active ? "" : "ghost"}
        title={title}
        style={{
          listStyle: "none", cursor: "pointer", padding: "5px 11px", fontSize: 13,
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 6, userSelect: "none", whiteSpace: "nowrap",
          background: active ? "var(--accent)" : "transparent",
          color: active ? "white" : "var(--text)",
        }}
      >
        {label}
        {active && current ? ` · ${current.label}` : ""} <span style={{ fontSize: 10 }}>▾</span>
      </summary>
      <div
        className="card"
        style={{
          position: "absolute", zIndex: 40, top: "calc(100% + 4px)", left: 0,
          minWidth: 180, maxHeight: 260, overflowY: "auto", padding: 8,
          display: "flex", flexDirection: "column", gap: 2,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              className="ghost"
              onClick={() => { onChange(o.value); if (ref.current) ref.current.open = false; }}
              style={{
                display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                padding: "4px 6px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
                border: "none", background: sel ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent",
                color: "var(--text)", textAlign: "left", width: "100%",
              }}
            >
              <span style={{ width: 14, textAlign: "center" }}>{sel ? "✓" : ""}</span>
              {o.label}
            </button>
          );
        })}
      </div>
    </details>
  );
}

export function PeriodBar({
  period,
  filters,
  onPeriod,
  onFilters,
}: {
  period: Period;
  filters: Filters;
  onPeriod: (p: Period) => void;
  onFilters: (f: Filters) => void;
}) {
  const t = useT();
  // Agent / Source dropdown options. Loaded once per leads-source; failures
  // degrade to empty lists (dropdowns render with no choices but the bar
  // keeps working).
  const [options, setOptions] = useState<FilterOptionsResponse>({ agents: [], sources: [] });
  useEffect(() => {
    let alive = true;
    fetch(`/api/dashboard/filter-options?leads_source=${filters.leadsSource}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { agents: [], sources: [] }))
      .then((j) => alive && setOptions({ agents: j.agents ?? [], sources: j.sources ?? [] }))
      .catch(() => alive && setOptions({ agents: [], sources: [] }));
    return () => { alive = false; };
  }, [filters.leadsSource]);

  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/dashboard/campaigns`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((j) => alive && setCampaigns(j.campaigns ?? []))
      .catch(() => alive && setCampaigns([]));
    return () => { alive = false; };
  }, []);
  // Custom date pickers stay hidden behind the 📅 Personnalisé button until
  // wanted (or a range is already active), mirroring the legacy bar.
  const [showCustom, setShowCustom] = useState(false);
  // Debounced search: type freely, propagate to the API-driven tabs 350ms
  // after the last keystroke.
  const [searchDraft, setSearchDraft] = useState(filters.q);
  useEffect(() => setSearchDraft(filters.q), [filters.q]);
  useEffect(() => {
    if (searchDraft === filters.q) return;
    const id = setTimeout(() => onFilters({ ...filters, q: searchDraft }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);
  // Today (local) as YYYY-MM-DD, so the calendar can't pick a future day and we
  // can pre-fill the input when a specific day is the active period.
  const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  // Current Du/Au values, derived from the active period preset. A single
  // "date:" day shows up as Du = Au = that day.
  const range = (() => {
    if (period.preset.startsWith("range:")) {
      const [, f, t2] = period.preset.split(":");
      return { du: f ?? "", au: t2 ?? "" };
    }
    if (period.preset.startsWith("date:")) {
      const d = period.preset.slice(5);
      return { du: d, au: d };
    }
    return { du: "", au: "" };
  })();
  const hasRange = Boolean(range.du || range.au);
  // Emit a range, filling a missing end with the other side and ordering them.
  const emitRange = (du: string, au: string) => {
    if (!du && !au) return;
    let f = du || au;
    let t2 = au || du;
    if (f > t2) [f, t2] = [t2, f]; // ISO date strings sort chronologically
    onPeriod({ ...presetToRange(`range:${f}:${t2}`), preset: `range:${f}:${t2}` });
  };
  const resetAll = () => {
    onPeriod({ ...presetToRange("today"), preset: "today" });
    onFilters({ ...DEFAULT_FILTERS });
    setShowCustom(false);
  };
  // "Période active" chip — same affordance as the legacy bar so the
  // operator always sees what's currently scoping every tab.
  const activeLabel = (() => {
    const preset = PRESETS.find((p) => p.id === period.preset);
    if (preset) return t(preset.label);
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    const a = fmt(period.from);
    const b = fmt(period.to);
    return a === b ? a : `${a} – ${b}`;
  })();
  return (
    <div
      className="card"
      style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 10 }}
    >
      <span className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {t("Période")}
      </span>
      <span
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
          fontSize: 12, borderRadius: 999, whiteSpace: "nowrap",
          border: "1px solid var(--accent)",
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
        }}
        title={t("Période active")}
      >
        ✓ {activeLabel}
      </span>
      <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {PRESETS.map((p) => {
          const active = period.preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => { onPeriod({ ...presetToRange(p.id), preset: p.id }); setShowCustom(false); }}
              className={active ? "" : "ghost"}
              style={{ padding: "5px 11px", fontSize: 13 }}
            >
              {t(p.label)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className={hasRange || showCustom ? "" : "ghost"}
          style={{ padding: "5px 11px", fontSize: 13 }}
          title={t("Choisir une date ou un intervalle précis")}
        >
          📅 {t("Personnalisé")}
        </button>
      </div>

      {/* Pick a specific day or an interval, like the legacy dashboard. For a
          single day, set Du and Au to the same date. Selecting a range
          deactivates the presets (none match "range:..."). */}
      {(showCustom || hasRange) && (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>{t("Du")}</span>
        <input
          type="date"
          value={range.du}
          max={range.au || todayStr}
          onChange={(e) => emitRange(e.target.value, range.au)}
          className={hasRange ? "" : "ghost"}
          style={{
            padding: "4px 8px", fontSize: 13, width: "auto", colorScheme: "dark",
            borderColor: hasRange ? "var(--accent)" : "var(--border)",
          }}
          title={t("Date de début")}
        />
        <span className="muted" style={{ fontSize: 12 }}>{t("Au")}</span>
        <input
          type="date"
          value={range.au}
          min={range.du || undefined}
          max={todayStr}
          onChange={(e) => emitRange(range.du, e.target.value)}
          className={hasRange ? "" : "ghost"}
          style={{
            padding: "4px 8px", fontSize: 13, width: "auto", colorScheme: "dark",
            borderColor: hasRange ? "var(--accent)" : "var(--border)",
          }}
          title={t("Date de fin")}
        />
      </div>
      )}

      <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Source leads")}</span>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => onFilters({ ...filters, leadsSource: "prod" })}
              className={filters.leadsSource === "prod" ? "" : "ghost"}
              style={{
                padding: "4px 12px", fontSize: 12, border: "none", borderRadius: 0,
                background: filters.leadsSource === "prod" ? "var(--good)" : "transparent",
                color: filters.leadsSource === "prod" ? "white" : "var(--text)",
              }}
              title={t("leads_rdv (production OCC)")}
            >
              Prod
            </button>
            <button
              type="button"
              onClick={() => onFilters({ ...filters, leadsSource: "test" })}
              className={filters.leadsSource === "test" ? "" : "ghost"}
              style={{
                padding: "4px 12px", fontSize: 12, border: "none", borderRadius: 0,
                background: filters.leadsSource === "test" ? "var(--warn)" : "transparent",
                color: filters.leadsSource === "test" ? "white" : "var(--text)",
              }}
              title={t("leads_rdv_test_axon (sandbox)")}
            >
              Test
            </button>
          </div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Sens")}</span>
          <select
            value={filters.direction}
            onChange={(e) => onFilters({ ...filters, direction: e.target.value as Filters["direction"] })}
            style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}
          >
            <option value="all">{t("Tous")}</option>
            <option value="inbound">{t("↘ Entrants")}</option>
            <option value="outbound">{t("↗ Sortants")}</option>
          </select>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Créneau")}</span>
          <select
            value={filters.slot}
            onChange={(e) => onFilters({ ...filters, slot: e.target.value as Filters["slot"] })}
            style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}
            title={t("Filtrer par créneau d'appel OCC")}
          >
            <option value="all">{t("Tous")}</option>
            <option value="morning">{t("Matin (08h-11h)")}</option>
            <option value="afternoon">{t("Après-midi (13h-14h)")}</option>
            <option value="evening">{t("Soir (18h-20h)")}</option>
          </select>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Système")}</span>
          <select
            value={filters.system}
            onChange={(e) => onFilters({ ...filters, system: e.target.value as Filters["system"] })}
            style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}
            title={t("Filtrer par système d'appel (Retell ou Axon)")}
          >
            <option value="all">{t("Tous")}</option>
            <option value="retell">Retell</option>
            <option value="axon">Axon</option>
          </select>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Campagne")}</span>
          <select
            value={filters.campaignId}
            onChange={(e) => onFilters({ ...filters, campaignId: e.target.value })}
            style={{ width: "auto", padding: "5px 8px", fontSize: 13, maxWidth: 180 }}
            title={t("Filtrer par campagne")}
          >
            <option value="all">{t("Toutes")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={resetAll}
          style={{ padding: "5px 11px", fontSize: 12, whiteSpace: "nowrap" }}
          title={t("Effacer tous les filtres et revenir à Aujourd'hui")}
        >
          ↺ {t("Réinitialiser")}
        </button>
      </div>

      {/* Second row — the legacy dashboard's global filters. Defaults are
          all-pass, so the dashboard behaves exactly as before until the
          operator picks something. */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          width: "100%", paddingTop: 8, borderTop: "1px solid var(--border)",
        }}
      >
        <MultiDrop
          label={t("Durée")}
          options={GLOBAL_DURATION_BUCKETS.map((b) => ({ value: b.id, label: b.label }))}
          selected={filters.durations}
          onChange={(durations) => onFilters({ ...filters, durations })}
        />
        <MultiDrop
          label={t("Qualification")}
          options={QUAL_BUCKETS.map((b) => ({ value: b.key, label: b.label }))}
          selected={filters.quals}
          onChange={(quals) => onFilters({ ...filters, quals: quals as Filters["quals"] })}
        />
        {/* Always rendered (even while options load / when empty) so the bar
            never loses controls — the popover shows "—" when there is
            nothing to pick. */}
        <MultiDrop
          label={t("Source")}
          options={options.sources.map((s) => ({ value: s, label: s }))}
          selected={filters.sources}
          onChange={(sources) => onFilters({ ...filters, sources })}
        />
        <MultiDrop
          label={t("Agent")}
          options={options.agents.map((a) => ({ value: a, label: a }))}
          selected={filters.agents}
          onChange={(agents) => onFilters({ ...filters, agents })}
        />
        <SingleDrop
          label={t("Tentative")}
          value={filters.attempt}
          options={[
            { value: "all", label: t("Toutes") },
            { value: "1", label: t("1ère") },
            { value: "2", label: t("2ème") },
            { value: "3plus", label: t("3ème et +") },
          ]}
          onChange={(attempt) => onFilters({ ...filters, attempt: attempt as Filters["attempt"] })}
          title={t("Numéro de tentative pour ce lead dans la période")}
        />
        <SingleDrop
          label={t("Éligibilité")}
          value={filters.eligibility}
          options={[
            { value: "all", label: t("Toutes") },
            { value: "eligible", label: t("Éligible") },
            { value: "ineligible", label: t("Non éligible") },
            { value: "unknown", label: t("Inconnue") },
          ]}
          onChange={(eligibility) => onFilters({ ...filters, eligibility: eligibility as Filters["eligibility"] })}
          title={t("Éligibilité S2 du lead (BMI ≥ 40)")}
        />
        <SingleDrop
          label={t("Décroché")}
          value={filters.answered}
          options={[
            { value: "all", label: t("Tous") },
            { value: "yes", label: t("Décrochés") },
            { value: "no", label: t("Sans réponse") },
          ]}
          onChange={(answered) => onFilters({ ...filters, answered: answered as Filters["answered"] })}
        />
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder={t("Rechercher nom, téléphone, résumé…")}
          style={{ flex: 1, minWidth: 200, padding: "5px 10px", fontSize: 13 }}
        />
      </div>
    </div>
  );
}
