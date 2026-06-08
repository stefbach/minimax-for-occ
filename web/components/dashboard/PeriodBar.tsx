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
      </div>
    </div>
  );
}
