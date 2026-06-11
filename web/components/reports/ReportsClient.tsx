"use client";

import { useState } from "react";
import type { ReportPayload, ReportType } from "@/lib/reports/types";
import { ReportViewer } from "./ReportViewer";

interface TemplateOption {
  id: ReportType;
  label: string;
  description: string;
  available: boolean;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: "pilotage_hebdo",
    label: "Pilotage hebdomadaire",
    description: "Synthèse semaine de prospection (funnel, qualifs, plan d'action).",
    available: true,
  },
  {
    id: "bilan_mensuel",
    label: "Bilan mensuel",
    description: "Cumul du mois — performance, tendances, conversion.",
    available: false,
  },
  {
    id: "perf_par_agent",
    label: "Performance par agent",
    description: "Comparaison des résultats par agent humain / IA.",
    available: false,
  },
  {
    id: "funnel_campagne",
    label: "Funnel campagne",
    description: "Analyse détaillée par campagne en cours.",
    available: false,
  },
  {
    id: "nhs_s2",
    label: "Pilotage NHS S2",
    description: "Reporting transfrontalier NHS — pipeline dossiers.",
    available: false,
  },
];

type Period = "this_week" | "this_month" | "custom";

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
  const [type, setType] = useState<ReportType>("pilotage_hebdo");
  const [period, setPeriod] = useState<Period>("this_week");
  const [customFrom, setCustomFrom] = useState<string>(isoDaysAgoUtc(7));
  const [customTo, setCustomTo] = useState<string>(isoTodayUtc());
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resolvePeriod(): { from: string; to: string } {
    if (period === "custom") {
      return {
        from: new Date(customFrom + "T00:00:00.000Z").toISOString(),
        to: new Date(customTo + "T00:00:00.000Z").toISOString(),
      };
    }
    if (period === "this_month") {
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { from: from.toISOString(), to: to.toISOString() };
    }
    // this_week — last 7 days rolling
    return {
      from: new Date(isoDaysAgoUtc(7) + "T00:00:00.000Z").toISOString(),
      to: new Date(isoTodayUtc() + "T00:00:00.000Z").toISOString(),
    };
  }

  async function generate() {
    const selected = TEMPLATES.find((t) => t.id === type);
    if (selected && !selected.available) {
      setError(`Le template "${selected.label}" arrive bientôt — v1 disponible : Pilotage hebdomadaire.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { from, to } = resolvePeriod();
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, from, to }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setReport(j as ReportPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur génération");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1>Rapports de pilotage</h1>
          <div className="subtitle">
            Génération automatisée — synthèse exécutive, KPIs, plan d&apos;action et vigilance.
          </div>
        </div>
      </div>

      {!report && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                Type de rapport
              </label>
              <div style={{ display: "grid", gap: 8 }}>
                {TEMPLATES.map((tpl) => (
                  <label
                    key={tpl.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: 12,
                      border: `1px solid ${type === tpl.id ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 6,
                      cursor: tpl.available ? "pointer" : "not-allowed",
                      opacity: tpl.available ? 1 : 0.55,
                      background: type === tpl.id ? "var(--surface-2)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="report-type"
                      value={tpl.id}
                      checked={type === tpl.id}
                      onChange={() => setType(tpl.id)}
                      disabled={!tpl.available}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {tpl.label}
                        {!tpl.available && (
                          <span
                            style={{
                              fontSize: 10,
                              marginLeft: 8,
                              padding: "1px 6px",
                              borderRadius: 4,
                              background: "var(--surface-3)",
                              color: "var(--muted-2)",
                            }}
                          >
                            BIENTÔT
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 2 }}>
                        {tpl.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                Période
              </label>
              <div style={{ display: "grid", gap: 8 }}>
                {(["this_week", "this_month", "custom"] as Period[]).map((p) => (
                  <label
                    key={p}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: 10,
                      border: `1px solid ${period === p ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: period === p ? "var(--surface-2)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="period"
                      value={p}
                      checked={period === p}
                      onChange={() => setPeriod(p)}
                    />
                    <span style={{ fontSize: 13 }}>
                      {p === "this_week" ? "Cette semaine (7 derniers jours)" :
                       p === "this_month" ? "Ce mois" : "Période personnalisée"}
                    </span>
                  </label>
                ))}
                {period === "custom" && (
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "var(--muted-2)", marginBottom: 4 }}>Du</div>
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "var(--muted-2)", marginBottom: 4 }}>Au</div>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    background: "var(--accent)",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? "Génération…" : "✨ Générer le rapport"}
                </button>
                {error && (
                  <div style={{ marginTop: 12, padding: 10, background: "var(--bad-bg, #f8e7ea)", color: "var(--bad, #a4243b)", borderRadius: 4, fontSize: 12 }}>
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {report && (
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
              ← Nouveau rapport
            </button>
          </div>
          <ReportViewer report={report} />
        </div>
      )}
    </div>
  );
}
