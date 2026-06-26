"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeadsResponse } from "@/app/api/dashboard/leads/route";
import type { LeadsAnalysisResponse } from "@/app/api/dashboard/leads-analysis/route";
import type { LeadsHandoffResponse } from "@/app/api/dashboard/leads-handoff/route";
import { useT } from "@/lib/i18n";
import type { Filters } from "./PeriodBar";
import { appendGlobalFilters, globalFilterParams } from "@/lib/global-filters";
import { DrillSheet, type DrillSpec, type DrillFilters } from "@/components/dashboard/DrillSheet";
import type { QualBucket } from "@/lib/qualification";

const CAT_COLORS = {
  passer_humain: "#f59e0b",
  rappel:        "#3b82f6",
  pas_interesse: "#ef4444",
  rdv_confirme:  "#22c55e",
};

function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
    </div>
  );
}

// Thin clickable wrapper that turns a card into a drill-down trigger.
function Clickable({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: "unset", display: "block", width: "100%",
        cursor: "pointer", borderRadius: "inherit",
      }}
    >
      {children}
    </button>
  );
}

type Props = {
  from: string;
  to: string;
  direction?: string | null;
  leadsSource?: string | null;
  system?: string | null;
  global?: Filters;
  refreshKey?: number;
  orgId?: string;
  campaignId?: string;
};

export function LeadsTab({ from, to, direction, leadsSource, system, global, refreshKey, orgId, campaignId }: Props) {
  const t = useT();
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [analysis, setAnalysis] = useState<LeadsAnalysisResponse | null>(null);
  const [handoff, setHandoff] = useState<LeadsHandoffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drillSpec, setDrillSpec] = useState<DrillSpec | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams({
        from,
        to,
        ...(direction && { direction }),
        ...(leadsSource && { leads_source: leadsSource }),
        ...(system && { system }),
        ...(global && global.quals.length && { gf_qual: global.quals.join(",") }),
        ...(global && global.agents.length && { gf_agent: global.agents.join(",") }),
        ...(global && global.answered !== "all" && { gf_answered: global.answered }),
        ...(global && global.attempt !== "all" && { gf_attempt: global.attempt }),
        ...(global && global.durations.length && { gf_dur: global.durations.join(",") }),
        ...(global && global.eligibility !== "all" && { gf_elig: global.eligibility }),
        ...(global && global.sources.length && { gf_src: global.sources.join(",") }),
        ...(global && global.q && { gf_q: global.q }),
        ...(orgId && { org_id: orgId }),
        ...(campaignId && campaignId !== "all" && { campaign_id: campaignId }),
      });

      const analysisQs = new URLSearchParams({ from, to });
      if (direction) analysisQs.set("direction", direction);
      if (leadsSource) analysisQs.set("leads_source", leadsSource);
      if (system) analysisQs.set("system", system);
      if (global) appendGlobalFilters(analysisQs, global);

      const handoffQs = new URLSearchParams({ hours: "48" });
      if (leadsSource) handoffQs.set("leads_source", leadsSource);

      const [res, analysisRes, handoffRes] = await Promise.all([
        fetch(`/api/dashboard/leads?${qs}`, { cache: "no-store" }),
        fetch(`/api/dashboard/leads-analysis?${analysisQs}`, { cache: "no-store" }),
        fetch(`/api/dashboard/leads-handoff?${handoffQs}`, { cache: "no-store" }),
      ]);

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as LeadsResponse;
      setData(j);

      if (analysisRes.ok) {
        const aj = (await analysisRes.json()) as LeadsAnalysisResponse;
        setAnalysis(aj);
      }
      if (handoffRes.ok) {
        const hj = (await handoffRes.json()) as LeadsHandoffResponse;
        setHandoff(hj);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, [from, to, direction, leadsSource, system, global, orgId, campaignId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // Only show full-page spinner on first load — during refreshes keep
  // the existing content visible to avoid a flash.
  if (loading && !data) {
    return <div className="card" style={{ padding: 20 }}>{t("Chargement…")}</div>;
  }

  if (error) {
    return <div className="card" style={{ padding: 20, color: "var(--bad)" }}>Erreur : {error}</div>;
  }

  if (!data) {
    return <div className="card" style={{ padding: 20 }}>{t("Aucune donnée")}</div>;
  }

  const { stats } = data;

  // Base DrillFilters shared by every card — period + scope + global filters.
  const baseDrill: DrillFilters = {
    from,
    to,
    ...(direction && direction !== "all" ? { direction } : {}),
    leads_source: (leadsSource === "test" ? "test" : "prod") as "prod" | "test",
    ...(system === "retell" || system === "axon" ? { system: system as "retell" | "axon" } : {}),
    gf: global ? globalFilterParams(global) : undefined,
  };

  const openDrill = (extra: Partial<DrillFilters>, spec: Omit<DrillSpec, "filters">) =>
    setDrillSpec({ ...spec, filters: { ...baseDrill, ...extra } });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── Pipeline leads ─────────────────────────────────────────────────── */}
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}
      >
        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {t("Leads uniques")}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: "var(--accent-2)", letterSpacing: -0.4 }}>
            {stats.total_unique_contacts}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("personnes différentes appelées")}</div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {t("Total appels")}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: "var(--accent-2)", letterSpacing: -0.4 }}>
            {stats.total_calls}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("appels passés")}</div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {t("Appels / lead")}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: "var(--accent-2)", letterSpacing: -0.4 }}>
            {stats.avg_calls_per_contact}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("moyenne par personne")}</div>
        </div>

        {analysis && (
          <div className="card" style={{ padding: 14 }}>
            <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
              {t("Appels décrochés")}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: "#22c55e", letterSpacing: -0.4 }}>
              {analysis.totalAnswered}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("sur la période")}</div>
          </div>
        )}

        <Clickable onClick={() => openDrill(
          { qualification: "rdv_confirme" },
          { title: "RDV confirmés", icon: "✅", tone: "var(--good)" },
        )}>
          <div className="card" style={{ padding: 14, cursor: "pointer" }}>
            <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
              {t("RDV confirmés")}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: "var(--good)", letterSpacing: -0.4 }}>
              {stats.rdv_confirmed}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("conversion confirmée")}</div>
          </div>
        </Clickable>

        <Clickable onClick={() => openDrill(
          { qualification: "passer_humain" },
          { title: "Transferts humain", icon: "👤", tone: CAT_COLORS.passer_humain },
        )}>
          <div className="card" style={{ padding: 14, cursor: "pointer" }}>
            <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
              {t("Transferts humain")}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: "var(--accent)", letterSpacing: -0.4 }}>
              {stats.rdv_transfer}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("à confirmer")}</div>
          </div>
        </Clickable>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 14 }}>{t("Distribution des appels par lead")}</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "8px 0", fontWeight: 600 }}>{t("Tentatives")}</th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>{t("Leads")}</th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>{t("Appels")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.calls_distribution.map((row) => (
              <tr key={row.attempt} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 0" }}>{row.attempt === 10 ? "10+" : row.attempt}</td>
                <td style={{ textAlign: "right", padding: "8px 0" }}>{row.contacts}</td>
                <td style={{ textAlign: "right", padding: "8px 0" }}>{row.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Analyse décroché (answered calls only) ────────────────────────── */}
      {analysis && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)", paddingTop: 4 }}>
            Analyse décroché
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>

            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 4 }}>
                Personnes uniques
              </div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>
                {analysis.uniqueIndividuals}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>contacts distincts atteints</div>
            </div>

            <Clickable onClick={() => openDrill(
              { qualification: "passer_humain", answered: "yes" },
              { title: "À passer à l'humain", icon: "👤", tone: CAT_COLORS.passer_humain },
            )}>
              <div className="card" style={{ padding: "16px 18px", cursor: "pointer" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 4 }}>
                  À passer à l&apos;humain
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: CAT_COLORS.passer_humain, lineHeight: 1 }}>
                    {analysis.passerHumain.count}
                  </span>
                  <span style={{ fontSize: 14, color: CAT_COLORS.passer_humain, fontWeight: 600 }}>
                    {analysis.passerHumain.pct}%
                  </span>
                </div>
                <PctBar pct={analysis.passerHumain.pct} color={CAT_COLORS.passer_humain} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Rain / Summer</div>
              </div>
            </Clickable>

            <Clickable onClick={() => openDrill(
              { qualification: "pas_interesse", answered: "yes" },
              { title: "Pas intéressé", icon: "✕", tone: CAT_COLORS.pas_interesse },
            )}>
              <div className="card" style={{ padding: "16px 18px", cursor: "pointer" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 4 }}>
                  Pas intéressé
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: CAT_COLORS.pas_interesse, lineHeight: 1 }}>
                    {analysis.pasInteresse.count}
                  </span>
                  <span style={{ fontSize: 14, color: CAT_COLORS.pas_interesse, fontWeight: 600 }}>
                    {analysis.pasInteresse.pct}%
                  </span>
                </div>
                <PctBar pct={analysis.pasInteresse.pct} color={CAT_COLORS.pas_interesse} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>des décrochés</div>
              </div>
            </Clickable>

            <Clickable onClick={() => openDrill(
              { qualification: "rappel", answered: "yes" },
              { title: "Rappel demandé", icon: "↩", tone: CAT_COLORS.rappel },
            )}>
              <div className="card" style={{ padding: "16px 18px", cursor: "pointer" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 4 }}>
                  Rappel demandé
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: CAT_COLORS.rappel, lineHeight: 1 }}>
                    {analysis.rappel.count}
                  </span>
                  <span style={{ fontSize: 14, color: CAT_COLORS.rappel, fontWeight: 600 }}>
                    {analysis.rappel.pct}%
                  </span>
                </div>
                <PctBar pct={analysis.rappel.pct} color={CAT_COLORS.rappel} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>des décrochés</div>
              </div>
            </Clickable>

            <Clickable onClick={() => openDrill(
              { qualification: "rdv_confirme", answered: "yes" },
              { title: "RDV confirmés (décrochés)", icon: "✅", tone: CAT_COLORS.rdv_confirme },
            )}>
              <div className="card" style={{ padding: "16px 18px", cursor: "pointer" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 4 }}>
                  RDV confirmés
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: CAT_COLORS.rdv_confirme, lineHeight: 1 }}>
                    {analysis.rdvConfirme.count}
                  </span>
                  <span style={{ fontSize: 14, color: CAT_COLORS.rdv_confirme, fontWeight: 600 }}>
                    {analysis.rdvConfirme.pct}%
                  </span>
                </div>
                <PctBar pct={analysis.rdvConfirme.pct} color={CAT_COLORS.rdv_confirme} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>des décrochés</div>
              </div>
            </Clickable>
          </div>

          {analysis.qualBreakdown.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span>Qualifications — décrochés uniquement</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
                  % sur {analysis.totalAnswered} décrochés
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {analysis.qualBreakdown.map((q) => {
                  const color =
                    q.key === "passer_humain" ? CAT_COLORS.passer_humain
                    : q.key === "pas_interesse" ? CAT_COLORS.pas_interesse
                    : q.key === "rappel" ? CAT_COLORS.rappel
                    : q.key === "rdv_confirme" ? CAT_COLORS.rdv_confirme
                    : q.key === "non_eligible" ? "#8b5cf6"
                    : q.key === "ne_pas_rappeler" ? "#6b7280"
                    : q.key === "faux_numero" ? "#f97316"
                    : "var(--accent)";
                  return (
                    <button
                      key={q.key}
                      type="button"
                      onClick={() => openDrill(
                        { qualification: q.key as QualBucket, answered: "yes" },
                        { title: q.label, tone: color },
                      )}
                      style={{ all: "unset", display: "block", cursor: "pointer", borderRadius: 4 }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{q.label}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{q.count} · {q.pct}%</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(q.pct, 100)}%`, height: "100%", background: color, borderRadius: 3 }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Handoff queue (passer_humain + suivi_requis, last 48 h) ─────── */}
      {handoff && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)", paddingTop: 4 }}>
            Transferts à traiter
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header row */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderBottom: "1px solid var(--border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  fontSize: 22, fontWeight: 700,
                  color: handoff.total > 0 ? CAT_COLORS.passer_humain : "var(--muted)",
                }}>
                  {handoff.total}
                </span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  lead{handoff.total !== 1 ? "s" : ""} à passer à Rain / Summer
                  <span style={{ fontSize: 11, marginLeft: 6 }}>(dernières {handoff.window_hours}h)</span>
                </span>
              </div>
              {handoff.total > 0 && (
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => openDrill(
                    { qualification: "passer_humain" },
                    { title: "Transferts humain", icon: "👤", tone: CAT_COLORS.passer_humain },
                  )}
                >
                  Voir tout →
                </button>
              )}
            </div>

            {/* Lead rows */}
            {handoff.calls.length === 0 ? (
              <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--muted)" }}>
                Aucun transfert en attente sur les dernières {handoff.window_hours}h.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {handoff.calls.slice(0, 8).map((hc) => (
                  <button
                    key={hc.id}
                    type="button"
                    onClick={() => openDrill(
                      { qualification: hc.bucket },
                      { title: hc.contact_name ?? hc.phone ?? "Lead", icon: "👤", tone: CAT_COLORS.passer_humain },
                    )}
                    style={{
                      all: "unset", display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 16px", cursor: "pointer",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: hc.bucket === "passer_humain"
                        ? `color-mix(in srgb, ${CAT_COLORS.passer_humain} 20%, transparent)`
                        : "color-mix(in srgb, var(--accent) 15%, transparent)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700,
                      color: hc.bucket === "passer_humain" ? CAT_COLORS.passer_humain : "var(--accent)",
                    }}>
                      {(hc.contact_name ?? hc.phone ?? "?")[0].toUpperCase()}
                    </div>

                    {/* Name + reason */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {hc.contact_name ?? hc.phone ?? "Inconnu"}
                      </div>
                      {hc.reason && (
                        <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                          {hc.reason}
                        </div>
                      )}
                    </div>

                    {/* Bucket badge + time */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                        textTransform: "uppercase", letterSpacing: 0.3,
                        background: hc.bucket === "passer_humain"
                          ? `color-mix(in srgb, ${CAT_COLORS.passer_humain} 15%, transparent)`
                          : "color-mix(in srgb, var(--accent) 10%, transparent)",
                        color: hc.bucket === "passer_humain" ? CAT_COLORS.passer_humain : "var(--accent)",
                      }}>
                        {hc.bucket === "passer_humain" ? "Humain" : "Suivi requis"}
                      </span>
                      {hc.called_at && (
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>
                          {new Date(hc.called_at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {handoff.calls.length > 8 && (
                  <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                    + {handoff.calls.length - 8} autres — cliquez sur "Voir tout" pour la liste complète
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <DrillSheet spec={drillSpec} onClose={() => setDrillSpec(null)} />
    </div>
  );
}
