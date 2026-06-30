"use client";

import { useState } from "react";
import type { ReportPayload, ReportType } from "@/lib/reports/types";
import { ReportViewer } from "./ReportViewer";
import { useT, useLang } from "@/lib/i18n";

interface TemplateOption {
  id: ReportType;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  available: boolean;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: "pilotage_hebdo",
    label: "Pilotage hebdomadaire",
    labelEn: "Weekly management",
    description: "Synthèse semaine de prospection — funnel, qualifs, plan d'action.",
    descriptionEn: "Weekly prospecting summary — funnel, qualifs, action plan.",
    icon: "▤",
    available: true,
  },
  {
    id: "bilan_mensuel",
    label: "Bilan mensuel",
    labelEn: "Monthly summary",
    description: "Cumul du mois — performance, tendances, conversion.",
    descriptionEn: "Month cumulative — performance, trends, conversion.",
    icon: "◷",
    available: true,
  },
  {
    id: "perf_par_agent",
    label: "Performance par agent",
    labelEn: "Agent performance",
    description: "Comparaison des résultats par agent humain / IA.",
    descriptionEn: "Result comparison by human / AI agent.",
    icon: "◉",
    available: false,
  },
  {
    id: "funnel_campagne",
    label: "Funnel campagne",
    labelEn: "Campaign funnel",
    description: "Analyse détaillée par campagne en cours.",
    descriptionEn: "Detailed analysis per active campaign.",
    icon: "⇈",
    available: false,
  },
  {
    id: "nhs_s2",
    label: "Pilotage NHS S2",
    labelEn: "NHS S2 management",
    description: "Reporting transfrontalier NHS — pipeline dossiers.",
    descriptionEn: "NHS cross-border reporting — case pipeline.",
    icon: "◐",
    available: false,
  },
];

type Period = "today" | "this_week" | "this_month" | "custom";

function isoTodayUtc(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgoUtc(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ReportsClient() {
  const t = useT();
  const siteLang = useLang();
  const [type, setType] = useState<ReportType>("pilotage_hebdo");
  const [period, setPeriod] = useState<Period>("this_week");
  const [customFrom, setCustomFrom] = useState<string>(isoDaysAgoUtc(7));
  const [customTo, setCustomTo] = useState<string>(isoTodayUtc());
  const [lang, setLang] = useState<"fr" | "en">(() => siteLang === "en" ? "en" : "fr");
  const [loading, setLoading] = useState(false);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isFr = lang === "fr";

  function resolvePeriod(): { from: string; to: string } {
    if (period === "custom") {
      return {
        from: new Date(customFrom + "T00:00:00.000Z").toISOString(),
        to: new Date(customTo + "T23:59:59.999Z").toISOString(),
      };
    }
    if (period === "today") {
      const from = new Date(isoTodayUtc() + "T00:00:00.000Z");
      const to = new Date();
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (period === "this_month") {
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { from: from.toISOString(), to: to.toISOString() };
    }
    return {
      from: new Date(isoDaysAgoUtc(7) + "T00:00:00.000Z").toISOString(),
      to: new Date(isoTodayUtc() + "T23:59:59.999Z").toISOString(),
    };
  }

  async function generate() {
    const selected = TEMPLATES.find((t) => t.id === type);
    if (selected && !selected.available) {
      setError(isFr
        ? `Le template "${selected.label}" arrive bientôt.`
        : `Template "${selected.labelEn}" coming soon.`
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { from, to } = resolvePeriod();
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, from, to, lang }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setReport(j as ReportPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Erreur génération"));
    } finally {
      setLoading(false);
    }
  }

  async function downloadExcel() {
    setXlsxLoading(true);
    try {
      const { from, to } = resolvePeriod();
      const params = new URLSearchParams({ from, to, lang });
      const res = await fetch(`/api/reports/patient-export?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `patients-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Erreur export"));
    } finally {
      setXlsxLoading(false);
    }
  }

  if (report) {
    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setReport(null)}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ← {t("Nouveau rapport")}
          </button>
        </div>
        <ReportViewer report={report} />
      </div>
    );
  }

  const PERIODS: Array<{ id: Period; label: string; hint: string }> = [
    { id: "today", label: t("Aujourd'hui"), hint: t("journée en cours") },
    { id: "this_week", label: t("Cette semaine"), hint: t("7 derniers jours") },
    { id: "this_month", label: t("Ce mois"), hint: t("depuis le 1er") },
    { id: "custom", label: t("Personnalisé"), hint: t("choisir les dates") },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div className="page-header" style={{ marginBottom: 22, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1>{t("Rapports de pilotage")}</h1>
          <div className="subtitle">
            {t("Synthèse exécutive, KPIs, plan d'action et vigilance — générés à la demande.")}
          </div>
        </div>
        {/* Language toggle */}
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
          {(["fr", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: lang === l ? "var(--accent, #ff6b35)" : "transparent",
                color: lang === l ? "white" : "var(--muted-2)",
                letterSpacing: 0.5,
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 1 — TYPE */}
      <div style={{ marginBottom: 8, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, color: "var(--muted-2)" }}>
          1 · {t("Choisir le type de rapport")}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-2)" }}>
          {TEMPLATES.filter((tpl) => tpl.available).length} {t("disponible")} · {TEMPLATES.filter((tpl) => !tpl.available).length} {t("à venir")}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 26 }}>
        {TEMPLATES.map((tpl) => {
          const selected = type === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => tpl.available && setType(tpl.id)}
              disabled={!tpl.available}
              style={{
                textAlign: "left",
                padding: 14,
                borderRadius: 8,
                border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: selected ? "var(--surface-2, rgba(255,107,53,0.06))" : "var(--surface, transparent)",
                cursor: tpl.available ? "pointer" : "not-allowed",
                opacity: tpl.available ? 1 : 0.5,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                transition: "border-color 0.12s, background 0.12s",
              }}
              aria-pressed={selected}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18, color: selected ? "var(--accent)" : "var(--muted)", width: 22, textAlign: "center" }} aria-hidden="true">
                  {tpl.icon}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{isFr ? tpl.label : tpl.labelEn}</span>
                {!tpl.available && (
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 3, background: "var(--surface-3, rgba(0,0,0,0.08))", color: "var(--muted-2)" }}>
                    {t("BIENTÔT")}
                  </span>
                )}
                {selected && tpl.available && <span aria-hidden="true" style={{ fontSize: 14, color: "var(--accent)", fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.45, paddingLeft: 30 }}>
                {isFr ? tpl.description : tpl.descriptionEn}
              </div>
            </button>
          );
        })}
      </div>

      {/* SECTION 2 — PÉRIODE */}
      <div style={{ marginBottom: 8, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, color: "var(--muted-2)" }}>
        2 · {t("Choisir la période")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
        {PERIODS.map((p) => {
          const selected = period === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: 6,
                border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: selected ? "var(--surface-2, rgba(255,107,53,0.06))" : "var(--surface, transparent)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                transition: "border-color 0.12s, background 0.12s",
              }}
              aria-pressed={selected}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</span>
              <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{p.hint}</span>
            </button>
          );
        })}
      </div>

      {period === "custom" && (
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--muted-2)", marginBottom: 4, display: "block" }}>{t("Du")}</label>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid var(--border)", borderRadius: 5, fontSize: 13 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--muted-2)", marginBottom: 4, display: "block" }}>{t("Au")}</label>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid var(--border)", borderRadius: 5, fontSize: 13 }} />
          </div>
        </div>
      )}

      {/* CTAs */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          style={{
            padding: "11px 22px",
            background: loading ? "var(--muted, #94a3b8)" : "var(--accent, #ff6b35)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {loading ? (
            <>
              <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "rpt-spin 0.8s linear infinite" }} />
              {t("Génération en cours…")}
            </>
          ) : (
            <>{t("✦ Générer le rapport")}</>
          )}
        </button>

        <button
          type="button"
          onClick={downloadExcel}
          disabled={xlsxLoading}
          style={{
            padding: "11px 18px",
            background: xlsxLoading ? "var(--muted, #94a3b8)" : "#1E7A4D",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
            cursor: xlsxLoading ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {xlsxLoading ? (
            <>
              <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "rpt-spin 0.8s linear infinite" }} />
              {t("Export…")}
            </>
          ) : (
            <>{t("⬇ Export Excel patients")}</>
          )}
        </button>

        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
          {loading
            ? t("Lecture des appels + rédaction IA, ~5 secondes.")
            : t("Le rapport s'ouvre dans un viewer, exportable en PDF.")}
        </span>
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bad-bg, #f8e7ea)", color: "var(--bad, #a4243b)", borderRadius: 5, fontSize: 12, borderLeft: "3px solid var(--bad, #a4243b)" }}>
          {error}
        </div>
      )}

      <style>{`@keyframes rpt-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
