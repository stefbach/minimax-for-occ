"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeadsAnalysisResponse } from "@/app/api/dashboard/leads-analysis/route";
import type { GlobalFilters } from "@/lib/global-filters";
import { appendGlobalFilters } from "@/lib/global-filters";
import { DEFAULT_GLOBAL_FILTERS } from "@/lib/global-filters";

// Colour scheme for the 4 outcome categories
const CAT_COLORS = {
  passerHumain: "#f59e0b",   // amber — needs human action
  rappel:       "#3b82f6",   // blue — callback
  pasInteresse: "#ef4444",   // red — closed/lost
  rdvConfirme:  "#22c55e",   // green — converted
};

function pctBar(pct: number, color: string) {
  return (
    <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s" }} />
    </div>
  );
}

type Props = {
  from: string;
  to: string;
  direction: string;
  leadsSource?: "prod" | "test";
  system?: "all" | "retell" | "axon";
  global?: GlobalFilters;
};

export function LeadsAnalysisTab({ from, to, direction, leadsSource = "prod", system = "all", global = DEFAULT_GLOBAL_FILTERS }: Props) {
  const [data, setData] = useState<LeadsAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        from,
        to,
        direction,
        leads_source: leadsSource,
        system,
      });
      appendGlobalFilters(qs, global);
      const res = await fetch(`/api/dashboard/leads-analysis?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [from, to, direction, leadsSource, system, global]);

  useEffect(() => { fetch_(); }, [fetch_]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        Chargement de l&apos;analyse…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ color: "var(--bad)", padding: 20 }}>
        {error ?? "Aucune donnée"}
      </div>
    );
  }

  const { totalAnswered, uniqueIndividuals, passerHumain, pasInteresse, rappel, rdvConfirme, qualBreakdown } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Headline KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>

        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 6 }}>
            Appels décrochés
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: "#22c55e", lineHeight: 1 }}>
            {totalAnswered}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            sur la période sélectionnée
          </div>
        </div>

        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 6 }}>
            Personnes uniques
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>
            {uniqueIndividuals}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            contacts distincts atteints
          </div>
        </div>

        {/* À passer à l'humain */}
        <div className="card" style={{ padding: "18px 20px", borderColor: passerHumain.count > 0 ? CAT_COLORS.passerHumain : undefined }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 6 }}>
            À passer à l&apos;humain
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: CAT_COLORS.passerHumain, lineHeight: 1 }}>
              {passerHumain.count}
            </span>
            <span style={{ fontSize: 16, color: CAT_COLORS.passerHumain, fontWeight: 600 }}>
              {passerHumain.pct}%
            </span>
          </div>
          {pctBar(passerHumain.pct, CAT_COLORS.passerHumain)}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            Rain / Summer
          </div>
        </div>

        {/* Pas intéressé */}
        <div className="card" style={{ padding: "18px 20px", borderColor: pasInteresse.count > 0 ? CAT_COLORS.pasInteresse : undefined }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 6 }}>
            Pas intéressé
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: CAT_COLORS.pasInteresse, lineHeight: 1 }}>
              {pasInteresse.count}
            </span>
            <span style={{ fontSize: 16, color: CAT_COLORS.pasInteresse, fontWeight: 600 }}>
              {pasInteresse.pct}%
            </span>
          </div>
          {pctBar(pasInteresse.pct, CAT_COLORS.pasInteresse)}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            des décrochés
          </div>
        </div>

        {/* Rappel demandé */}
        <div className="card" style={{ padding: "18px 20px", borderColor: rappel.count > 0 ? CAT_COLORS.rappel : undefined }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 6 }}>
            Rappel demandé
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: CAT_COLORS.rappel, lineHeight: 1 }}>
              {rappel.count}
            </span>
            <span style={{ fontSize: 16, color: CAT_COLORS.rappel, fontWeight: 600 }}>
              {rappel.pct}%
            </span>
          </div>
          {pctBar(rappel.pct, CAT_COLORS.rappel)}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            des décrochés
          </div>
        </div>

        {/* RDV confirmés */}
        <div className="card" style={{ padding: "18px 20px", borderColor: rdvConfirme.count > 0 ? CAT_COLORS.rdvConfirme : undefined }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 6 }}>
            RDV confirmés
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: CAT_COLORS.rdvConfirme, lineHeight: 1 }}>
              {rdvConfirme.count}
            </span>
            <span style={{ fontSize: 16, color: CAT_COLORS.rdvConfirme, fontWeight: 600 }}>
              {rdvConfirme.pct}%
            </span>
          </div>
          {pctBar(rdvConfirme.pct, CAT_COLORS.rdvConfirme)}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            des décrochés
          </div>
        </div>
      </div>

      {/* Qualification breakdown — answered calls only */}
      {qualBreakdown.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            Qualifications — appels décrochés uniquement
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {qualBreakdown.map((q) => {
              const color =
                q.key === "passer_humain" ? CAT_COLORS.passerHumain
                : q.key === "pas_interesse" ? CAT_COLORS.pasInteresse
                : q.key === "rappel" ? CAT_COLORS.rappel
                : q.key === "rdv_confirme" ? CAT_COLORS.rdvConfirme
                : q.key === "non_eligible" ? "#8b5cf6"
                : q.key === "ne_pas_rappeler" ? "#6b7280"
                : q.key === "faux_numero" ? "#f97316"
                : "var(--accent)";
              return (
                <div key={q.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{q.label}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {q.count} · {q.pct}%
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.min(q.pct, 100)}%`,
                        height: "100%",
                        background: color,
                        borderRadius: 3,
                        transition: "width 0.4s",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {totalAnswered === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Aucun appel décroché sur cette période.
        </div>
      )}
    </div>
  );
}
