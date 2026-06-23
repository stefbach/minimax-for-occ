"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { bucketForCall, normalizeQualification } from "@/lib/qualification";
import { matchesGlobalFilters, hasActiveGlobalFilters, DEFAULT_GLOBAL_FILTERS, type GlobalFilters } from "@/lib/global-filters";
import {
  buildReportData, generateCsv, generateXlsx, reportFilename, downloadBlob,
  type ReportCall, type ReportFrequency, type PatientRow, type PatientSections,
} from "@/lib/report";
import { ReportViewer } from "@/components/reports/ReportViewer";
import type { ReportPayload } from "@/lib/reports/types";

// "Générer un rapport" — dropdown with hover submenus: Daily / Weekly / Monthly / Custom × PDF | CSV.
// Custom shows an inline date-range picker. Patient detail sections (RDV CONFIRMÉ, À PASSER À L'HUMAIN)
// are appended to CSV exports and included as annexes in PDF reports.

type ExtFrequency = "daily" | "weekly" | "monthly" | "custom";

type Row = ReportCall & {
  answered_at: string | null;
  agent_handles?: { display_name: string | null } | null;
  contacts?: { display_name: string | null } | null;
  from_e164?: string | null;
  to_e164?: string | null;
  lead?: { name: string | null } | null;
};

interface PeriodInfo {
  from: string;
  to: string;
  label: string;
  type: "pilotage_hebdo" | "bilan_mensuel";
}

function periodForFreq(freq: ExtFrequency, customFrom?: string, customTo?: string): PeriodInfo {
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  if (freq === "custom" && customFrom && customTo) {
    // Use UTC midnight for from, and exclusive next-day midnight for to — this aligns with
    // the server's .lt("started_at", toIso) query and formatPeriodLabel (which subtracts 1 day).
    const fromDate = new Date(customFrom + "T00:00:00.000Z");
    const toDate = new Date(customTo + "T00:00:00.000Z");
    toDate.setUTCDate(toDate.getUTCDate() + 1); // exclusive end: start of next day
    // Build label at noon UTC so toLocaleDateString never rolls over to an adjacent day.
    const fromLabel = new Date(customFrom + "T12:00:00.000Z");
    const toLabel = new Date(customTo + "T12:00:00.000Z");
    const label = `${fromLabel.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })} – ${toLabel.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}`;
    return { from: fromDate.toISOString(), to: toDate.toISOString(), label, type: "pilotage_hebdo" };
  }

  if (freq === "daily") {
    return {
      from: today.toISOString(),
      to: now.toISOString(),
      label: today.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
      type: "pilotage_hebdo",
    };
  }

  if (freq === "monthly") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return {
      from: from.toISOString(),
      to: now.toISOString(),
      label: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      type: "bilan_mensuel",
    };
  }

  // weekly
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 7);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    label: `${from.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })} – ${today.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}`,
    type: "pilotage_hebdo",
  };
}

function toReportFreq(freq: ExtFrequency): ReportFrequency {
  if (freq === "daily") return "daily";
  return "weekly";
}

const GROUPS: { freq: ExtFrequency; labelFr: string; labelEn: string; icon: string }[] = [
  { freq: "daily",   labelFr: "Quotidien",    labelEn: "Daily",   icon: "📅" },
  { freq: "weekly",  labelFr: "Hebdomadaire", labelEn: "Weekly",  icon: "📆" },
  { freq: "monthly", labelFr: "Mensuel",      labelEn: "Monthly", icon: "🗓️" },
  { freq: "custom",  labelFr: "Personnalisé", labelEn: "Custom",  icon: "✏️" },
];

export function ReportButton({
  from,
  to,
  periodLabel,
  direction,
  leadsSource,
  system,
  global = DEFAULT_GLOBAL_FILTERS,
}: {
  from: string;
  to: string;
  periodLabel: string;
  direction: string;
  leadsSource: "prod" | "test";
  system: "all" | "retell" | "axon";
  global?: GlobalFilters;
}) {
  const t = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportPayload | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<ExtFrequency | null>(null);

  const enterGroup = (freq: ExtFrequency) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredGroup(freq);
  };
  const leaveGroup = () => {
    hoverTimer.current = setTimeout(() => setHoveredGroup(null), 220);
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState(todayStr);
  const [customTo, setCustomTo] = useState(todayStr);

  // suppress unused-prop warnings — kept for future CSV path that uses PeriodBar range
  void from; void to; void periodLabel;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) {
        el.open = false;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setHoveredGroup(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (preview) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [preview]);

  const runPdf = async (freq: ExtFrequency) => {
    if (ref.current) ref.current.open = false;
    setHoveredGroup(null);
    setBusy(true);
    setErr(null);
    try {
      const p = periodForFreq(freq, customFrom, customTo);
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: p.type, from: p.from, to: p.to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setPreview(j as ReportPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "report error");
    } finally {
      setBusy(false);
    }
  };

  const runCsv = async (freq: ExtFrequency) => {
    if (ref.current) ref.current.open = false;
    setHoveredGroup(null);
    setBusy(true);
    setErr(null);
    try {
      const p = periodForFreq(freq, customFrom, customTo);
      const reportFreq = toReportFreq(freq);

      const qs = new URLSearchParams({
        state: "ended,failed", limit: "2000",
        from: p.from, to: p.to,
        leads_source: leadsSource, enrich: "lead",
      });
      if (direction !== "all") qs.set("direction", direction);
      if (system !== "all") qs.set("system", system);

      const r = await fetch(`/api/calls?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      let rows: Row[] = Array.isArray(j) ? j : [];
      if (hasActiveGlobalFilters(global)) {
        const evaluable = { ...global, attempt: "all" as const, eligibility: "all" as const, sources: [] };
        rows = rows.filter((c) =>
          matchesGlobalFilters(evaluable, {
            durationSecs: c.duration_secs ?? 0,
            bucket: bucketForCall(c),
            agent: c.agent_handles?.display_name ?? null,
            answered: !!c.answered_at,
            attempt: null,
            eligibility: "unknown",
            source: null,
            haystack: `${c.lead?.name ?? ""} ${c.contacts?.display_name ?? ""} ${c.from_e164 ?? ""} ${c.to_e164 ?? ""}`.toLowerCase(),
          }),
        );
      }

      const data = buildReportData({ calls: rows, periodLabel: p.label, frequency: reportFreq });

      // Fetch patient data for this period and split by qualification
      let patientSections: PatientSections | undefined;
      try {
        const pqs = new URLSearchParams({ from: p.from, to: p.to });
        const pr = await fetch(`/api/reports/patient-list?${pqs.toString()}`, { cache: "no-store" });
        if (pr.ok) {
          const pj = (await pr.json()) as { patients: PatientRow[] };
          const allPats = pj.patients ?? [];
          patientSections = {
            rdvConfirme: allPats.filter((x) => normalizeQualification(x.qualification) === "rdv_confirme"),
            passerHumain: allPats.filter((x) => normalizeQualification(x.qualification) === "passer_humain"),
          };
        }
      } catch { /* non-fatal — CSV still downloads without patient sections */ }

      const blob = generateXlsx(data, reportFreq, patientSections);
      downloadBlob(blob, reportFilename({ periodLabel: p.label, frequency: reportFreq, format: "xlsx" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "report error");
    } finally {
      setBusy(false);
    }
  };

  const SUBMENU_STYLE: React.CSSProperties = {
    position: "absolute", left: "calc(100% + 4px)", top: 0, zIndex: 50,
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
    minWidth: 200,
    padding: 6,
    display: "flex", flexDirection: "column", gap: 4,
  };

  const BTN: React.CSSProperties = {
    border: "none", background: "transparent", color: "var(--text)",
    textAlign: "left", width: "100%", padding: "7px 10px", borderRadius: 5,
    fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
    display: "flex", alignItems: "center", gap: 8,
  };

  return (
    <>
      <details ref={ref} style={{ position: "relative", display: "inline-block" }}>
        <summary
          className="ghost"
          style={{
            listStyle: "none", cursor: busy ? "wait" : "pointer", userSelect: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", fontSize: 14, whiteSpace: "nowrap",
            border: "1px solid var(--border)", borderRadius: 8,
            opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto",
          }}
          title={err ?? undefined}
        >
          📄 {busy ? t("Génération…") : t("Générer un rapport")} <span style={{ fontSize: 10 }}>▾</span>
        </summary>

        <div
          className="card"
          style={{
            position: "absolute", zIndex: 40, top: "calc(100% + 4px)", right: 0,
            minWidth: 210, padding: 6, display: "flex", flexDirection: "column", gap: 2,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {GROUPS.map((g) => (
            <div
              key={g.freq}
              style={{ position: "relative" }}
              onMouseEnter={() => enterGroup(g.freq)}
              onMouseLeave={leaveGroup}
            >
              <button
                type="button"
                className="ghost"
                style={{
                  ...BTN,
                  justifyContent: "space-between",
                  fontWeight: hoveredGroup === g.freq ? 600 : 400,
                  background: hoveredGroup === g.freq ? "var(--surface-hover, rgba(255,255,255,0.06))" : "transparent",
                }}
              >
                <span>
                  <span style={{ marginRight: 7 }}>{g.icon}</span>
                  {t(g.labelFr)}
                </span>
                <span style={{ opacity: 0.5, fontSize: 11 }}>›</span>
              </button>

              {hoveredGroup === g.freq && (
                <div style={SUBMENU_STYLE}>
                  {g.freq === "custom" && (
                    <>
                      <div style={{ padding: "6px 8px 2px", fontSize: 12, color: "var(--muted)" }}>
                        {t("Du")}
                      </div>
                      <input
                        type="date"
                        value={customFrom}
                        max={customTo}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        style={{
                          margin: "0 4px", padding: "5px 8px", fontSize: 13,
                          background: "var(--bg)", color: "var(--text)",
                          border: "1px solid var(--border)", borderRadius: 5,
                        }}
                      />
                      <div style={{ padding: "6px 8px 2px", fontSize: 12, color: "var(--muted)" }}>
                        {t("Au")}
                      </div>
                      <input
                        type="date"
                        value={customTo}
                        min={customFrom}
                        onChange={(e) => setCustomTo(e.target.value)}
                        style={{
                          margin: "0 4px 6px", padding: "5px 8px", fontSize: 13,
                          background: "var(--bg)", color: "var(--text)",
                          border: "1px solid var(--border)", borderRadius: 5,
                        }}
                      />
                      <div style={{ height: 1, background: "var(--border)", margin: "0 4px 4px" }} />
                    </>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runPdf(g.freq)}
                    style={BTN}
                  >
                    <span>📄</span> PDF
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runCsv(g.freq)}
                    style={BTN}
                  >
                    <span>📊</span> Excel
                  </button>
                </div>
              )}
            </div>
          ))}

          {err && (
            <span style={{ color: "var(--bad)", fontSize: 12, padding: "4px 8px" }}>{err}</span>
          )}
        </div>
      </details>

      {/* ── Full-screen report preview overlay ─────────────────────────────── */}
      {preview && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.72)",
            display: "flex", flexDirection: "column",
            overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}
        >
          <div
            style={{
              position: "sticky", top: 0, zIndex: 10,
              background: "rgba(20,35,58,0.96)", backdropFilter: "blur(6px)",
              padding: "10px 20px",
              display: "flex", alignItems: "center", gap: 12,
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.25)",
                color: "white", borderRadius: 6, padding: "6px 14px",
                cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}
            >
              ✕ {t("Fermer")}
            </button>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
              {preview.title} · {preview.period.label}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                background: "var(--accent, #ff6b35)", border: "none",
                color: "white", borderRadius: 6, padding: "7px 18px",
                cursor: "pointer", fontSize: 13, fontWeight: 700,
              }}
            >
              ⤓ {t("Télécharger PDF")}
            </button>
          </div>

          <div style={{ padding: "24px 16px", flex: 1 }}>
            <ReportViewer report={preview} hideToolbar />
          </div>
        </div>
      )}
    </>
  );
}
