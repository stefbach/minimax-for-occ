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
function fmtMoney(n: number, unit = "$"): string {
  return `${unit}${n.toFixed(2)}`;
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
        if (alive) { setData(j); setError(null); }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to, direction]);

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;

  const k = data.kpis;
  const rdvBooked = data.qualifications.find((q) => q.key === "rdv_confirme")?.count ?? 0;
  const toHuman = data.qualifications.find((q) => q.key === "passer_humain")?.count ?? 0;
  const totalRdv = rdvBooked + toHuman;
  const convRate = k.total > 0 ? totalRdv / k.total : 0;
  const maxVol = Math.max(1, ...data.volume.map((b) => b.count));
  const maxHeat = Math.max(1, ...data.heatmap.map((c) => c.count));
  const maxHist = Math.max(1, ...data.duration_histogram.map((b) => b.count));
  const maxAttempt = Math.max(1, ...data.attempt_funnel.map((a) => a.total));

  // ─── Row 1 — Business KPIs (6 cards) ───
  const kpiCards: { label: string; value: string; sub?: string; tone?: string; highlight?: boolean }[] = [
    { label: t("Appels totaux"), value: k.total.toLocaleString(), sub: `${k.answered} ${t("décrochés")}`, tone: "var(--info)" },
    { label: t("RDV obtenus"), value: totalRdv.toLocaleString(), sub: `${rdvBooked} confirmés · ${toHuman} à passer humain`, tone: "var(--good)", highlight: true },
    { label: t("Taux de conversion"), value: pct(convRate), sub: `${totalRdv} / ${k.total} ${t("appels")}`, tone: "var(--accent-2)" },
    { label: t("Coût réel"), value: fmtMoney(k.cost_real || k.cost_estimate), sub: k.cost_is_real ? t("mesuré") : t("estimé"), tone: "var(--warn)" },
    { label: t("Coût par RDV"), value: data.cost_per_rdv > 0 ? fmtMoney(data.cost_per_rdv) : "—", sub: data.cost_per_rdv > 0 ? t("ratio dépense / résultat") : t("pas encore de RDV"), tone: data.cost_per_rdv > 0 ? "var(--accent)" : "var(--muted)" },
    { label: t("Durée moyenne (décrochés)"), value: fmtDuration(k.avg_duration_secs), sub: `${pct(k.answer_rate)} ${t("taux de décroché")}`, tone: "var(--info)" },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ─── KPI ROW ─── */}
      <div className="grid-kpi">
        {kpiCards.map((tile) => (
          <div
            key={tile.label}
            className="card"
            style={{ padding: 16, borderColor: tile.highlight ? "var(--good)" : undefined }}
          >
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
              {tile.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: tile.tone }}>
              {tile.value}
            </div>
            {tile.sub && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{tile.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ─── CONVERSION FUNNEL ─── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Entonnoir de conversion")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Où tombent tes leads — chaque étape comparée au total initial")}
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {data.funnel.map((step, i) => {
            const w = Math.max(2, step.pct_of_total * 100);
            const drop = i > 0 ? data.funnel[i - 1].count - step.count : 0;
            return (
              <div key={step.key} style={{ display: "grid", gridTemplateColumns: "180px 1fr 110px", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 13 }}>{step.label}</div>
                <div style={{ background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 22, position: "relative" }}>
                  <div style={{ width: `${w}%`, height: "100%", background: i === data.funnel.length - 1 ? "var(--good)" : "var(--accent)" }} />
                </div>
                <div style={{ fontSize: 12, textAlign: "right" }}>
                  <strong>{step.count}</strong> <span className="muted">({pct(step.pct_of_total)})</span>
                  {i > 0 && drop > 0 && <div className="muted" style={{ fontSize: 10, color: "var(--bad)" }}>− {drop}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── TWO COLUMNS: Qualifications + Lead Source ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Qualifications")}</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {t("Résultat de chaque appel, normalisé en 9 catégories")}
          </p>
          {data.qualifications.every((q) => q.count === 0) ? (
            <p className="muted" style={{ fontSize: 13 }}>{t("Aucune qualification dans la période.")}</p>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {data.qualifications.map((q) => {
                const max = Math.max(1, ...data.qualifications.map((x) => x.count));
                return (
                  <div key={q.key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 40px", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12 }}>{q.label}</span>
                    <div style={{ background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 14 }}>
                      <div style={{ width: `${(q.count / max) * 100}%`, height: "100%", background: q.count > 0 ? "var(--accent)" : "transparent" }} />
                    </div>
                    <span className="muted" style={{ fontSize: 12, textAlign: "right" }}>{q.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Attribution par source de lead")}</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {t("Conversion par origine du lead (Facebook, Google, etc.)")}
          </p>
          {data.sources.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {t("Aucune table de leads avec colonne source_lead configurée.")}
            </p>
          ) : (
            <table className="list" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>{t("Source")}</th>
                  <th style={{ textAlign: "right" }}>{t("Appels")}</th>
                  <th style={{ textAlign: "right" }}>{t("RDV")}</th>
                  <th style={{ textAlign: "right" }}>{t("Conv %")}</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td style={{ textAlign: "right" }}>{s.total}</td>
                    <td style={{ textAlign: "right" }}>{s.rdv}</td>
                    <td style={{ textAlign: "right", color: s.conv_rate > 0 ? "var(--good)" : "var(--muted)" }}>
                      {pct(s.conv_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── QUAND APPELER — Jour × Heure ─── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Quand appeler — Jour × Heure")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Densité d'activité par créneau — heures locales du serveur")}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <th></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} style={{ width: 22, textAlign: "center", color: "var(--muted)", fontWeight: 400, paddingBottom: 4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((day, dayIdx) => (
                <tr key={day}>
                  <td style={{ paddingRight: 8, color: "var(--muted)" }}>{day}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = data.heatmap.find((c) => c.weekday === dayIdx && c.hour === h);
                    const intensity = cell ? cell.count / maxHeat : 0;
                    const bg = intensity > 0
                      ? `color-mix(in srgb, var(--accent) ${20 + intensity * 80}%, transparent)`
                      : "var(--bg-2)";
                    return (
                      <td
                        key={h}
                        title={`${day} ${h}:00 — ${cell?.count ?? 0} appels`}
                        style={{ width: 22, height: 18, background: bg, border: "1px solid var(--bg-1)" }}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── TWO COLUMNS: Performance agent + Distribution durées ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Performance par agent")}</h3>
          <table className="list" style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{t("Agent")}</th>
                <th style={{ textAlign: "right" }}>{t("Appels")}</th>
                <th style={{ textAlign: "right" }}>{t("Décrochés")}</th>
                <th style={{ textAlign: "right" }}>{t("Durée moy.")}</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.agent}>
                  <td>{a.agent}</td>
                  <td style={{ textAlign: "right" }}>{a.total}</td>
                  <td style={{ textAlign: "right" }}>{a.answered} <span className="muted">({pct(a.answer_rate)})</span></td>
                  <td style={{ textAlign: "right" }}>{fmtDuration(a.avg_duration_secs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Distribution des durées")}</h3>
          {data.duration_histogram.map((b) => (
            <div key={b.key} style={{ display: "grid", gridTemplateColumns: "80px 1fr 36px", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>{b.key}</span>
              <div style={{ background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 14 }}>
                <div style={{ width: `${(b.count / maxHist) * 100}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <span className="muted" style={{ fontSize: 12, textAlign: "right" }}>{b.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── ATTEMPT FUNNEL ─── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Tentatives → décroché")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Combien d'essais avant qu'un patient décroche, et taux de réussite à chaque tentative")}
        </p>
        {data.attempt_funnel.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{t("Pas assez de données.")}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.attempt_funnel.length}, 1fr)`, gap: 10 }}>
            {data.attempt_funnel.map((a) => {
              const rate = a.total > 0 ? a.answered / a.total : 0;
              return (
                <div key={a.attempt} className="card" style={{ padding: 10 }}>
                  <div className="muted" style={{ fontSize: 11 }}>{a.attempt === 5 ? "5+ " : `${a.attempt}ᵉ`} {t("tentative")}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{a.total}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {a.answered} {t("décrochés")} ({pct(rate)})
                  </div>
                  <div style={{ background: "var(--bg-2)", borderRadius: 4, height: 6, marginTop: 6, overflow: "hidden" }}>
                    <div style={{ width: `${(a.total / maxAttempt) * 100}%`, height: "100%", background: "var(--accent)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── VOLUME PAR PÉRIODE (en bas, moins critique) ─── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Volume d'appels")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {data.granularity === "hour" ? t("Par heure") : t("Par jour")}
        </p>
        {data.volume.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{t("Aucun appel sur la période.")}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(data.volume.length, 30)}, 1fr)`, gap: 2, alignItems: "end", height: 80 }}>
            {data.volume.slice(-30).map((b) => (
              <div
                key={b.key}
                title={`${b.key}: ${b.count}`}
                style={{
                  background: "var(--accent)", height: `${(b.count / maxVol) * 100}%`,
                  minHeight: 2, borderRadius: 2,
                }}
              />
            ))}
          </div>
        )}
        {data.truncated && (
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {t("Résultat tronqué à 8 000 appels — affine la période pour des stats exactes.")}
          </p>
        )}
      </div>
    </div>
  );
}
