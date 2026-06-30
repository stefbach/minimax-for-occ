"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * DynamicEngineConfig — the client-configurable rules for a "continuous"
 * campaign that re-selects leads from a data table at each time slot.
 *
 * Everything is column-MAPPED (Q1=B): the client tells Axon which column in
 * THEIR table holds the status, the callback datetime, and the per-phase
 * date/attempts trackers — so any tenant works without hardcoded names.
 *
 * Emits a `EngineConfig` object the wizard stores in campaigns.metadata.engine.
 */

export interface PhaseConfig {
  name: string;
  date_column: string;
  attempts_column: string;
  wait_business_days: number;
}

export interface EngineConfig {
  selection: {
    status_column: string;
    include_statuses: string[];
    phone_starts_with: string;
    phone_min_len: number | null;
    phone_max_len: number | null;
    /** Optional second filter (ANDed with the status whitelist): restrict to
     *  rows whose `assigned_column` is one of `assigned_values`. Used by human
     *  desk campaigns to call only the leads assigned to that agent. */
    assigned_column?: string | null;
    assigned_values?: string[];
  };
  callback: { enabled: boolean; status_value: string; datetime_column: string };
  cadence: {
    enabled: boolean;
    business_days_only: boolean;
    max_attempts_per_phase: number;
    phases: PhaseConfig[];
  };
  slots: { days: number[]; hours: string[]; timezone: string };
  volume: { max_new_per_day: number; wave_size: number; wave_pause_secs: number };
}

interface Column { key: string; label: string; type: string; }

const DAYS = [
  { n: 1, l: "L" }, { n: 2, l: "M" }, { n: 3, l: "M" }, { n: 4, l: "J" },
  { n: 5, l: "V" }, { n: 6, l: "S" }, { n: 0, l: "D" },
];

const TIMEZONES = [
  "Europe/London", "Europe/Paris", "Indian/Mauritius", "America/New_York", "UTC",
];

// Detect retry-phase column pairs by name, so the user doesn't have to pick
// them from dropdowns when their table follows the OCC-style convention
// (or one of a few common variants). Returns a list of phases ready to drop
// into cadence.phases.
//
// Patterns recognised (case-insensitive):
//   date_j{N}              ↔ j{N}_attempts                 (OCC prod)
//   appel_j{N}             ↔ tentatives_j{N}               (FR variant)
//   phase{N}_called_at     ↔ phase{N}_attempts             (EN variant)
//   relance_{N}_date       ↔ relance_{N}_count             (recouvrement-style)
//   j{N}_called_at         ↔ j{N}_attempts                 (Axon default)
function detectPhases(columns: Column[]): PhaseConfig[] {
  const cols = columns.map((c) => c.key);

  // Each pattern: regex that captures the phase number on the DATE column,
  // and a builder for the matching ATTEMPTS column name.
  const patterns: { dateRe: RegExp; attemptsFor: (n: string) => string[] }[] = [
    { dateRe: /^date_j(\d+)$/i,            attemptsFor: (n) => [`j${n}_attempts`, `tentatives_j${n}`] },
    { dateRe: /^j(\d+)_called_at$/i,       attemptsFor: (n) => [`j${n}_attempts`] },
    { dateRe: /^appel_j(\d+)$/i,           attemptsFor: (n) => [`tentatives_j${n}`, `j${n}_attempts`] },
    { dateRe: /^phase(\d+)_called_at$/i,   attemptsFor: (n) => [`phase${n}_attempts`] },
    { dateRe: /^relance_(\d+)_date$/i,     attemptsFor: (n) => [`relance_${n}_count`, `relance_${n}_attempts`] },
  ];

  const matches = new Map<string, { dateCol: string; attemptsCol: string }>();
  for (const col of cols) {
    for (const p of patterns) {
      const m = col.match(p.dateRe);
      if (!m) continue;
      const phaseNumber = m[1];
      // Skip if we already mapped this phase under a different pattern.
      if (matches.has(phaseNumber)) continue;
      const candidates = p.attemptsFor(phaseNumber);
      const attemptsCol = candidates.find((cand) => cols.includes(cand));
      if (!attemptsCol) continue;
      matches.set(phaseNumber, { dateCol: col, attemptsCol });
      break;
    }
  }

  if (matches.size === 0) return [];

  // Sort phases by their numeric label so J1 comes before J3 etc.
  const sorted = Array.from(matches.entries()).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );

  // Wait_business_days suggestion: cumulative day count following the phase
  // label. For J1/J3/J5 that gives 0 / 2 / 2 (delta between phases).
  return sorted.map(([n, { dateCol, attemptsCol }], idx) => {
    const days = Number(n);
    const prevDays = idx === 0 ? 0 : Number(sorted[idx - 1][0]);
    return {
      name: `J${n}`,
      date_column: dateCol,
      attempts_column: attemptsCol,
      wait_business_days: idx === 0 ? 0 : days - prevDays,
    };
  });
}

export function defaultEngineConfig(columns: Column[], phoneColumn: string): EngineConfig {
  const textCols = columns.filter((c) => c.type === "text");
  const dateCols = columns.filter((c) => c.type === "date" || c.type === "datetime");
  const numCols = columns.filter((c) => c.type === "number");
  const statusCol = textCols.find((c) => /qualif|status|statut|stage/i.test(c.key))?.key ?? textCols[0]?.key ?? "";
  const cbCol = dateCols.find((c) => /rappel|callback|recall/i.test(c.key))?.key ?? "";

  // Try the pattern-based auto-detection first. If nothing matches, fall back
  // to a single placeholder phase using the first date + first number column
  // (the user will then need to fix the dropdowns manually — but at least the
  // form isn't empty).
  const detectedPhases = detectPhases(columns);
  const phases: PhaseConfig[] = detectedPhases.length > 0
    ? detectedPhases
    : dateCols.length >= 1
      ? [{ name: "J1", date_column: dateCols[0]?.key ?? "", attempts_column: numCols[0]?.key ?? "", wait_business_days: 0 }]
      : [];

  return {
    selection: {
      status_column: statusCol,
      include_statuses: [],
      phone_starts_with: "",
      phone_min_len: null,
      phone_max_len: null,
      assigned_column: null,
      assigned_values: [],
    },
    callback: { enabled: Boolean(cbCol), status_value: "RAPPEL", datetime_column: cbCol },
    cadence: {
      // Auto-enable the cadence when we successfully detected named phases —
      // the user clearly has a table designed for multi-phase retries.
      enabled: detectedPhases.length > 0,
      business_days_only: true,
      max_attempts_per_phase: 3,
      phases,
    },
    slots: { days: [1, 2, 3, 4, 5], hours: ["09:00"], timezone: "Europe/London" },
    volume: { max_new_per_day: 200, wave_size: 15, wave_pause_secs: 60 },
  };
}

interface Props {
  columns: Column[];
  phoneColumn: string;
  value: EngineConfig;
  onChange: (cfg: EngineConfig) => void;
  /** When true, the créneaux (days/hours/timezone) block is hidden — the
   *  wizard renders a single, unified créneaux editor in step 3 instead. */
  hideSlots?: boolean;
  /** Section to render. 'all' (default) = the legacy full UI. 'no-cadence'
   *  hides the Relances block so it can be re-mounted in step 3 of the
   *  wizard (where multi-day retries logically belong). 'cadence-only'
   *  renders just that block. Both variants share state with the parent
   *  through value/onChange. */
  section?: "all" | "no-cadence" | "cadence-only";
}

export function DynamicEngineConfig({ columns, value, onChange, hideSlots = false, section = "all" }: Props) {
  const t = useT();
  const [statusInput, setStatusInput] = useState("");
  const textCols = columns.filter((c) => c.type === "text");
  const dateCols = columns.filter((c) => c.type === "date" || c.type === "datetime");
  const numCols = columns.filter((c) => c.type === "number");

  function set<K extends keyof EngineConfig>(key: K, v: EngineConfig[K]) {
    onChange({ ...value, [key]: v });
  }

  function addStatus() {
    const s = statusInput.trim();
    if (s && !value.selection.include_statuses.includes(s)) {
      set("selection", { ...value.selection, include_statuses: [...value.selection.include_statuses, s] });
    }
    setStatusInput("");
  }

  function toggleDay(n: number) {
    const days = value.slots.days.includes(n)
      ? value.slots.days.filter((d) => d !== n)
      : [...value.slots.days, n];
    set("slots", { ...value.slots, days });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {section !== "cadence-only" && (<>
      {/* ── Qui appeler ── */}
      <div style={box}>
        <h4 style={h4}>{t("Filtres : quels contacts cibler ?")}</h4>
        <div className="form-row">
          <div>
            <label>{t("Colonne « statut »")}</label>
            <select
              value={value.selection.status_column}
              onChange={(e) => set("selection", { ...value.selection, status_column: e.target.value })}
            >
              <option value="">{t("— choisir —")}</option>
              {textCols.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
            </select>
          </div>
          <div>
            <label>{t("Filtre numéro : commence par")}</label>
            <input
              value={value.selection.phone_starts_with}
              onChange={(e) => set("selection", { ...value.selection, phone_starts_with: e.target.value })}
              placeholder="+44"
            />
          </div>
        </div>
        <div>
          <label>{t("Statuts à appeler")}</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {value.selection.include_statuses.map((s) => (
              <span key={s} className="tag" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {s}
                <button type="button" onClick={() => set("selection", { ...value.selection, include_statuses: value.selection.include_statuses.filter((x) => x !== s) })}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
              </span>
            ))}
            {value.selection.include_statuses.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("Aucun → tous les contacts seront éligibles.")}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStatus(); } }}
              placeholder={t("ex: NOUVEAU DOSSIER (Entrée pour ajouter)")}
            />
            <button type="button" className="ghost" onClick={addStatus}>{t("Ajouter")}</button>
          </div>
        </div>
      </div>
      </>)}

      {section !== "no-cadence" && (<>
      {/* ── Relances ── */}
      <div style={box}>
        <h4 style={h4}>{t("Relances (suite d'appels)")}</h4>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={value.cadence.enabled}
            onChange={(e) => set("cadence", { ...value.cadence, enabled: e.target.checked })}
            style={{ width: "auto" }} />
          {t("Activer les relances multi-jours (J+X)")}
        </label>

        {value.cadence.enabled && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div className="form-row">
              <div>
                <label>{t("Colonne « rappel programmé » (prioritaire)")}</label>
                <select value={value.callback.datetime_column}
                  onChange={(e) => set("callback", { ...value.callback, datetime_column: e.target.value, enabled: Boolean(e.target.value) })}>
                  <option value="">{t("— aucune —")}</option>
                  {dateCols.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
                </select>
              </div>
              <div>
                <label>{t("Valeur de statut « rappel »")}</label>
                <input value={value.callback.status_value}
                  onChange={(e) => set("callback", { ...value.callback, status_value: e.target.value })}
                  placeholder="RAPPEL" />
              </div>
            </div>

            <div>
              <label>{t("Phases de relance")}</label>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                {t("Chaque phase note la date d'appel et le nombre de tentatives dans VOS colonnes.")}
                {value.cadence.phases.length > 0 &&
                  value.cadence.phases.every((p) =>
                    /^date_j\d+$|^j\d+_called_at$|^appel_j\d+$|^phase\d+_called_at$|^relance_\d+_date$/i.test(p.date_column),
                  ) && (
                    <span style={{ marginLeft: 6, color: "var(--good)" }}>
                      ✓ {t("Colonnes auto-détectées d'après les noms de ta table.")}
                    </span>
                  )}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {value.cadence.phases.map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 110px auto", gap: 6, alignItems: "center" }}>
                    <input value={p.name} placeholder="J1"
                      onChange={(e) => set("cadence", { ...value.cadence, phases: value.cadence.phases.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                    <select value={p.date_column}
                      onChange={(e) => set("cadence", { ...value.cadence, phases: value.cadence.phases.map((x, j) => j === i ? { ...x, date_column: e.target.value } : x) })}>
                      <option value="">{t("colonne date…")}</option>
                      {dateCols.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
                    </select>
                    <select value={p.attempts_column}
                      onChange={(e) => set("cadence", { ...value.cadence, phases: value.cadence.phases.map((x, j) => j === i ? { ...x, attempts_column: e.target.value } : x) })}>
                      <option value="">{t("colonne tentatives…")}</option>
                      {numCols.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
                    </select>
                    <input type="number" value={p.wait_business_days} title={t("Jours ouvrés d'attente avant cette phase")}
                      onChange={(e) => set("cadence", { ...value.cadence, phases: value.cadence.phases.map((x, j) => j === i ? { ...x, wait_business_days: Number(e.target.value) } : x) })} />
                    <button type="button" className="ghost" style={{ padding: "6px 10px" }}
                      onClick={() => set("cadence", { ...value.cadence, phases: value.cadence.phases.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <button type="button" className="ghost" style={{ justifySelf: "start" }}
                  onClick={() => set("cadence", { ...value.cadence, phases: [...value.cadence.phases, { name: `J${value.cadence.phases.length * 2 + 1}`, date_column: "", attempts_column: "", wait_business_days: value.cadence.phases.length * 2 }] })}>
                  + {t("Ajouter une phase")}
                </button>
              </div>
            </div>

            <div className="form-row">
              <div>
                <label>{t("Max tentatives par phase")}</label>
                <input type="number" value={value.cadence.max_attempts_per_phase}
                  onChange={(e) => set("cadence", { ...value.cadence, max_attempts_per_phase: Number(e.target.value) })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
                <input type="checkbox" checked={value.cadence.business_days_only}
                  onChange={(e) => set("cadence", { ...value.cadence, business_days_only: e.target.checked })}
                  style={{ width: "auto" }} />
                <span style={{ fontSize: 13 }}>{t("Jours ouvrés uniquement")}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      </>)}

      {section !== "cadence-only" && (<>
      {/* ── Créneaux ── */}
      {!hideSlots && (
      <div style={box}>
        <h4 style={h4}>{t("Créneaux (quand appeler)")}</h4>
        <div>
          <label>{t("Jours actifs")}</label>
          <div style={{ display: "flex", gap: 6 }}>
            {DAYS.map((d) => (
              <button key={d.n} type="button"
                onClick={() => toggleDay(d.n)}
                style={{
                  width: 36, height: 36, borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${value.slots.days.includes(d.n) ? "var(--accent)" : "var(--border)"}`,
                  background: value.slots.days.includes(d.n) ? "var(--accent-soft)" : "var(--bg-2)",
                  color: "inherit",
                }}>{d.l}</button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <div>
            <label>{t("Heures de tir")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {value.slots.hours.map((h, i) => (
                <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input type="time" value={h} style={{ width: "auto" }}
                    onChange={(e) => set("slots", { ...value.slots, hours: value.slots.hours.map((x, j) => j === i ? e.target.value : x) })} />
                  <button type="button" onClick={() => set("slots", { ...value.slots, hours: value.slots.hours.filter((_, j) => j !== i) })}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
                </span>
              ))}
              <button type="button" className="ghost" style={{ padding: "4px 10px" }}
                onClick={() => set("slots", { ...value.slots, hours: [...value.slots.hours, "13:00"] })}>+ {t("heure")}</button>
            </div>
          </div>
          <div>
            <label>{t("Fuseau horaire")}</label>
            <select value={value.slots.timezone} onChange={(e) => set("slots", { ...value.slots, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
      </div>
      )}

      {/* ── Volume ── */}
      <div style={box}>
        <h4 style={h4}>{t("Combien de nouveaux contacts par créneau ?")}</h4>
        <div className="form-row">
          <div>
            <label>{t("Nouveaux contacts max par créneau")}</label>
            <input type="number" value={value.volume.max_new_per_day}
              onChange={(e) => set("volume", { ...value.volume, max_new_per_day: Number(e.target.value) })} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
              {t("Combien de contacts")} <strong>{t("jamais encore appelés")}</strong> {t("on lance à chaque créneau.")}
              {" "}{t("Avec tes")} {Math.max(1, (value.slots.hours ?? []).length)} {t("créneau")}{(value.slots.hours ?? []).length > 1 ? "x" : ""}, {t("ça fait jusqu'à")}{" "}
              <strong>{value.volume.max_new_per_day * Math.max(1, (value.slots.hours ?? []).length)} {t("nouveaux/jour")}</strong>.
              {" "}{t("Les relances (rappels J+X) partent en plus, sans limite.")}
            </div>
          </div>
        </div>
      </div>
      </>)}
    </div>
  );
}

const box: React.CSSProperties = {
  background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14,
  display: "grid", gap: 10,
};
const h4: React.CSSProperties = { margin: 0, fontSize: 14 };
