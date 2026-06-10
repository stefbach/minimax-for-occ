"use client";

import { useT } from "@/lib/i18n";

export type Period = { from: string; to: string; preset: string };
export type Filters = {
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
    onFilters({ direction: "all", leadsSource: "prod", system: "all", slot: "all" });
  };
  return (
    <div
      className="card"
      style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 10 }}
    >
      <span className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {t("Période")}
      </span>
      <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {PRESETS.map((p) => {
          const active = period.preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPeriod({ ...presetToRange(p.id), preset: p.id })}
              className={active ? "" : "ghost"}
              style={{ padding: "5px 11px", fontSize: 13 }}
            >
              {t(p.label)}
            </button>
          );
        })}
      </div>

      {/* Pick a specific day or an interval, like the legacy dashboard. For a
          single day, set Du and Au to the same date. Selecting a range
          deactivates the presets (none match "range:..."). */}
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
    </div>
  );
}
