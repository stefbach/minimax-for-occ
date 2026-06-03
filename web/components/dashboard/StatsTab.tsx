"use client";

import { useEffect, useState } from "react";
import type { AnalyticsResponse } from "@/app/api/dashboard/analytics/route";
import { useT } from "@/lib/i18n";

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export function StatsTab({ from, to, direction }: { from: string; to: string; direction: string }) {
  const t = useT();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from, to });
    if (direction !== "all") qs.set("direction", direction);
    fetch(`/api/dashboard/analytics?${qs.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) {
          setData(j);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [from, to, direction]);

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;

  const k = data.kpis;
  const maxVol = Math.max(1, ...data.volume.map((b) => b.count));
  const maxHeat = Math.max(1, ...data.heatmap.map((c) => c.count));
  const heatLookup = new Map(data.heatmap.map((c) => [`${c.weekday}_${c.hour}`, c.count]));
  const maxHist = Math.max(1, ...data.duration_histogram.map((b) => b.count));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {data.truncated && (
        <div className="card" style={{ borderColor: "var(--warn)", color: "var(--warn)", fontSize: 13 }}>
          Beaucoup d&apos;appels sur cette période — statistiques calculées sur un échantillon récent.
        </div>
      )}

      {/* KPI row */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 12 }}>
        <Kpi label={t("Appels")} value={String(k.total)} />
        <Kpi label={t("Réussis")} value={`${k.answered} · ${pct(k.answer_rate)}`} tone="good" />
        <Kpi label={t("Taux d'abandon")} value={pct(k.abandon_rate)} tone={k.abandon_rate > 0.5 ? "bad" : "muted"} />
        <Kpi label={t("Durée moyenne")} value={fmtDuration(k.avg_duration_secs)} />
        <Kpi label={`↘ / ↗`} value={`${k.inbound} / ${k.outbound}`} />
        <Kpi label={t("Coût estimé")} value={`$${k.cost_estimate.toFixed(2)}`} hint={`~$${k.cost_per_min}/min`} />
      </div>

      {/* Volume + Dispositions */}
      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Volume d'appels")} · {data.granularity === "hour" ? t("par heure") : t("par jour")}</h3>
          {data.volume.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>{t("Aucune donnée")}</p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 160, overflowX: "auto" }}>
              {data.volume.map((b) => (
                <div key={b.key} title={`${b.key} · ${b.count}`} style={{ flex: "1 0 6px", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                  <div style={{ width: "100%", height: `${(b.count / maxVol) * 140}px`, background: "var(--accent)", borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Top dispositions")}</h3>
          {data.dispositions.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>{t("Aucune donnée")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {data.dispositions.slice(0, 8).map((d) => (
                <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, minWidth: 130 }}>{d.key}</span>
                  <div style={{ flex: 1, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 14 }}>
                    <div style={{ width: `${(d.count / data.dispositions[0].count) * 100}%`, height: "100%", background: "var(--accent-2)" }} />
                  </div>
                  <span className="muted" style={{ fontSize: 12, minWidth: 30, textAlign: "right" }}>{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Heatmap */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Heures de pointe")}</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <th></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="muted" style={{ padding: "0 2px", fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                <tr key={wd}>
                  <td className="muted" style={{ paddingRight: 6 }}>{t(DAY_LABELS[wd])}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const c = heatLookup.get(`${wd}_${h}`) ?? 0;
                    const intensity = c / maxHeat;
                    return (
                      <td key={h} title={`${t(DAY_LABELS[wd])} ${h}h · ${c}`} style={{ padding: 1 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 2, background: c === 0 ? "var(--bg-2)" : `rgba(255,107,53,${0.15 + intensity * 0.85})` }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent performance + Duration histogram */}
      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Performance par agent")}</h3>
          {data.agents.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>{t("Aucune donnée")}</p>
          ) : (
            <table className="list" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("Agent")}</th><th>{t("Appels")}</th><th>{t("Réussis")}</th><th>{t("Durée moyenne")}</th></tr></thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.agent}>
                    <td>{a.agent}</td>
                    <td>{a.total}</td>
                    <td>{a.answered} <span className="muted">({pct(a.answer_rate)})</span></td>
                    <td>{fmtDuration(a.avg_duration_secs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Distribution des durées")}</h3>
          <div style={{ display: "grid", gap: 6 }}>
            {data.duration_histogram.map((b) => (
              <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, minWidth: 70 }}>{b.key}</span>
                <div style={{ flex: 1, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 14 }}>
                  <div style={{ width: `${(b.count / maxHist) * 100}%`, height: "100%", background: "var(--info)" }} />
                </div>
                <span className="muted" style={{ fontSize: 12, minWidth: 30, textAlign: "right" }}>{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Attempt funnel */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Tentatives → décroché")}</h3>
        {data.attempt_funnel.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{t("Aucune donnée")}</p>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {data.attempt_funnel.map((a) => (
              <div key={a.attempt} className="card" style={{ padding: 12, minWidth: 120, background: "var(--bg-2)" }}>
                <div className="muted" style={{ fontSize: 12 }}>{a.attempt === 5 ? "5+ ᵉ" : `${a.attempt}ᵉ`} {t("tentative")}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{a.total}</div>
                <div className="muted" style={{ fontSize: 12 }}>{a.answered} {t("réussis").toLowerCase()} ({pct(a.total ? a.answered / a.total : 0)})</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "muted" }) {
  const color = tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : "var(--accent-2)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 2px", color }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}
