"use client";

import { useEffect, useState } from "react";
import type { AnalyticsResponse } from "@/app/api/dashboard/analytics/route";
import { useT } from "@/lib/i18n";
import { AlertTriangle, CalendarCheck, Clock, DollarSign, Flame, Lightbulb, Phone, Sparkles, Target } from "lucide-react";
import { appendGlobalFilters, globalFiltersKey, DEFAULT_GLOBAL_FILTERS, type GlobalFilters } from "@/lib/global-filters";

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

// "vs prev" delta — percentage change, and whether it's a "good" move (callers
// can invert for cost, where down is good).
function makeDelta(current: number, previous: number): { show: boolean; pct: number } {
  if (current === 0 && previous === 0) return { show: false, pct: 0 };
  if (previous === 0) return { show: true, pct: 100 };
  return { show: true, pct: ((current - previous) / Math.abs(previous)) * 100 };
}

// Heatmap cell colour: light → deep emerald driven by the rate (0–60%+).
function heatCellStyle(rate: number, total: number): { background: string; color: string } {
  if (total === 0) return { background: "color-mix(in srgb, var(--muted) 8%, transparent)", color: "var(--muted)" };
  const tt = Math.max(0, Math.min(1, rate / 60));
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * tt);
  return { background: `rgb(${lerp(40, 6)}, ${lerp(60, 145)}, ${lerp(55, 90)})`, color: tt > 0.45 ? "#fff" : "var(--muted)" };
}

export function StatsTab({ from, to, direction, leadsSource = "prod", system = "all", global = DEFAULT_GLOBAL_FILTERS, campaignId }: { from: string; to: string; direction: string; leadsSource?: "prod" | "test"; system?: "all" | "retell" | "axon"; global?: GlobalFilters; campaignId?: string }) {
  const t = useT();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heatMode, setHeatMode] = useState<"answer" | "rdv">("answer");

  const gfKey = globalFiltersKey(global);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from, to, leads_source: leadsSource });
    if (direction !== "all") qs.set("direction", direction);
    if (system !== "all") qs.set("system", system);
    if (campaignId && campaignId !== "all") qs.set("campaign_id", campaignId);
    appendGlobalFilters(qs, global);
    fetch(`/api/dashboard/analytics?${qs.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) { setData(j); setError(null); }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to, direction, leadsSource, system, gfKey, campaignId]);

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;

  const k = data.kpis;
  const prev = data.previous;
  const biz = data.business;
  const totalRdv = k.rdv_confirmed;
  const cost = k.cost_real || k.cost_estimate;
  const maxVol = Math.max(1, ...data.volume.map((b) => b.count));
  const maxHist = Math.max(1, ...data.duration_histogram.map((b) => b.count));
  const maxAttempt = Math.max(1, ...data.attempt_funnel.map((a) => a.total));

  // ─── Row 1 — Business KPIs (8 cards, with "vs prev" deltas) ───
  type Tile = {
    label: string; value: string; sub?: string; tone?: string; highlight?: boolean;
    delta?: { show: boolean; pct: number }; invertDelta?: boolean; pulse?: boolean;
  };
  const tiles: Tile[] = [
    { label: t("RDV obtenus"), value: totalRdv.toLocaleString(), sub: `${pct(k.conversion_rate)} ${t("des appels")}`, tone: "var(--good)", highlight: true, delta: makeDelta(totalRdv, prev.rdv) },
    { label: t("Taux de décroché"), value: pct(k.answer_rate), sub: `${k.answered.toLocaleString()} / ${k.total.toLocaleString()} ${t("appels")}`, tone: "var(--info)", delta: makeDelta(k.answered, prev.answered) },
    { label: t("Coût période"), value: fmtMoney(cost), sub: `${data.cost_per_rdv > 0 ? fmtMoney(data.cost_per_rdv) : "—"} ${t("par RDV")}`, tone: "var(--warn)", delta: makeDelta(cost, prev.cost), invertDelta: true },
    { label: t("Appels totaux"), value: k.total.toLocaleString(), sub: biz.total_leads > 0 ? `${biz.total_leads.toLocaleString()} ${t("leads en base")}` : undefined, tone: "var(--accent-2)", delta: makeDelta(k.total, prev.total) },
    { label: t("Éligibles dans le pipeline"), value: biz.eligible_in_pipeline.toLocaleString(), sub: t("BMI ≥ 40 & pas encore RDV"), tone: "var(--accent)" },
    { label: t("Appels moy. avant RDV"), value: biz.avg_calls_before_rdv > 0 ? biz.avg_calls_before_rdv.toFixed(1) : "—", sub: t("plus bas = mieux"), tone: "var(--accent)" },
    { label: t("Faux n° / sans réponse"), value: biz.wrong_num.toLocaleString(), sub: t("qualité de la liste"), tone: "var(--bad)" },
    { label: t("Actifs maintenant"), value: biz.active_calls.toLocaleString(), sub: biz.active_calls > 0 ? t("appels en direct") : t("au repos"), tone: "var(--good)", pulse: biz.active_calls > 0 },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ─── KPI ROW (8 tiles + vs-prev deltas) ─── */}
      <div className="grid-kpi">
        {tiles.map((tile) => {
          const good = tile.delta ? (tile.invertDelta ? tile.delta.pct <= 0 : tile.delta.pct >= 0) : true;
          return (
            <div key={tile.label} className="card" style={{ padding: 16, borderColor: tile.highlight ? "var(--good)" : undefined }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{tile.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: tile.tone }}>{tile.value}</span>
                {tile.pulse && (
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--good)", animation: "stat-pulse 1.2s ease-in-out infinite" }} />
                )}
              </div>
              {tile.delta?.show ? (
                <div style={{ fontSize: 11, marginTop: 4, fontFamily: "ui-monospace, monospace", color: good ? "var(--good)" : "var(--bad)" }}>
                  {tile.delta.pct >= 0 ? "↑ +" : "↓ "}{tile.delta.pct.toFixed(0)}% {t("vs préc.")}
                </div>
              ) : tile.sub ? (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{tile.sub}</div>
              ) : null}
            </div>
          );
        })}
      </div>
      <style jsx>{`@keyframes stat-pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>

      {/* ─── CALL COSTS ─── */}
      {(() => {
        const cp = data.cost_panel;
        const maxOut = Math.max(1, ...cp.by_outcome.map((o) => o.cost));
        const maxHour = Math.max(0.01, ...cp.by_hour.map((h) => h.cost));
        const costTiles: { label: string; value: string; sub?: string; tone?: string }[] = [
          { label: t("Dépense totale"), value: fmtMoney(cp.total), sub: `${k.total.toLocaleString()} ${t("appels")}`, tone: "var(--warn)" },
          { label: t("Coût moyen / appel"), value: fmtMoney(cp.avg_per_call), tone: "var(--info)" },
          { label: t("Coût par RDV"), value: cp.cost_per_rdv > 0 ? fmtMoney(cp.cost_per_rdv) : "—", tone: "var(--accent)" },
          { label: t("Gaspillé (faux n° / sans réponse)"), value: fmtMoney(cp.wasted), sub: `${pct(cp.wasted_pct)} ${t("de la dépense")}`, tone: "var(--bad)" },
        ];
        return (
          <div className="card">
            <h3 style={{ marginTop: 0, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}><DollarSign size={15} /> {t("Coûts des appels")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{fmtMoney(cp.total)} {t("dépensés")} · {fmtMoney(data.previous.cost)} {t("période précédente")}</p>
            <div className="grid-kpi" style={{ marginBottom: 14 }}>
              {costTiles.map((tile) => (
                <div key={tile.label} className="card" style={{ padding: 14 }}>
                  <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{tile.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: tile.tone }}>{tile.value}</div>
                  {tile.sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{tile.sub}</div>}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
              {/* Cost by hour */}
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>{t("Coût par heure")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, alignItems: "end", height: 90 }}>
                  {cp.by_hour.map((h) => (
                    <div key={h.hour} title={`${h.hour}h — ${fmtMoney(h.cost)}`} style={{ background: h.cost > 0 ? "var(--warn)" : "var(--bg-2)", height: `${Math.max(2, (h.cost / maxHour) * 100)}%`, borderRadius: 2, minHeight: 2 }} />
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 9, display: "flex", justifyContent: "space-between", marginTop: 2 }}><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
              </div>
              {/* Cost by outcome */}
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>{t("Coût par issue")}</div>
                {cp.by_outcome.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>{t("Aucun coût attribué.")}</p>
                ) : cp.by_outcome.map((o) => (
                  <div key={o.key} style={{ display: "grid", gridTemplateColumns: "120px 1fr 56px", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11 }}>{o.label}</span>
                    <div style={{ background: "var(--bg-2)", borderRadius: 4, height: 14, overflow: "hidden" }}>
                      <div style={{ width: `${(o.cost / maxOut) * 100}%`, height: "100%", background: "var(--warn)" }} />
                    </div>
                    <span className="muted" style={{ fontSize: 11, textAlign: "right" }}>{fmtMoney(o.cost)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* ─── QUAND APPELER — Jour × Heure (taux décroché / RDV) ─── */}
      {(() => {
        const rateOf = (c: { count: number; answered: number; rdv: number }) =>
          c.count === 0 ? 0 : ((heatMode === "rdv" ? c.rdv : c.answered) / c.count) * 100;
        const topSlots = [...data.heatmap]
          .filter((c) => c.count >= 3)
          .sort((a, b) => rateOf(b) - rateOf(a))
          .slice(0, 3);
        const topSet = new Set(topSlots.map((c) => `${c.weekday}-${c.hour}`));
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}><Flame size={15} /> {t("Quand appeler — Jour × Heure")}</h3>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  {heatMode === "rdv" ? t("Taux de RDV par créneau (≥3 appels)") : t("Taux de décroché par créneau (>15s, disconnect valide)")}
                </p>
              </div>
              <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {(["answer", "rdv"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setHeatMode(m)}
                    className={heatMode === m ? "" : "ghost"}
                    style={{ padding: "4px 10px", fontSize: 12, border: "none", borderRadius: 0,
                      background: heatMode === m ? "var(--accent)" : "transparent", color: heatMode === m ? "#fff" : "var(--text)" }}>
                    {m === "answer" ? <><Phone size={14} style={{ verticalAlign: "middle" }} /> {t("Décroché")}</> : <><CalendarCheck size={14} style={{ verticalAlign: "middle" }} /> {t("RDV")}</>}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 10 }}>
                <thead>
                  <tr>
                    <th></th>
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} style={{ minWidth: 30, textAlign: "center", color: "var(--muted)", fontWeight: 400, paddingBottom: 4 }}>{h}h</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAY_LABELS.map((day, dayIdx) => (
                    <tr key={day}>
                      <td style={{ paddingRight: 8, color: "var(--muted)", fontWeight: 600 }}>{day}</td>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = data.heatmap.find((c) => c.weekday === dayIdx && c.hour === h) ?? { count: 0, answered: 0, rdv: 0, weekday: dayIdx, hour: h };
                        const rate = rateOf(cell);
                        const st = heatCellStyle(rate, cell.count);
                        const isTop = topSet.has(`${dayIdx}-${h}`);
                        return (
                          <td key={h}
                            title={`${day} ${h}h · ${cell.count} appels · ${heatMode === "rdv" ? `${cell.rdv} RDV` : `${cell.answered} décrochés`} (${rate.toFixed(0)}%)`}
                            style={{ minWidth: 30, height: 24, textAlign: "center", borderRadius: 4, fontWeight: 600,
                              background: st.background, color: st.color,
                              outline: isTop ? "2px solid var(--warn)" : undefined }}>
                            {cell.count > 0 ? `${rate.toFixed(0)}%` : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Legend + top slots */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)" }}>
                <span>{t("Faible")}</span>
                {[0, 15, 30, 45, 60].map((r) => {
                  const s = heatCellStyle(r, 1);
                  return <span key={r} style={{ background: s.background, color: s.color, padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>{r}%</span>;
                })}
                <span>{t("Élevé")}</span>
              </div>
              {topSlots.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 12 }}>{t("Top créneaux")} :</span>
                  {topSlots.map((c) => (
                    <span key={`${c.weekday}-${c.hour}`} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, border: "1px solid color-mix(in srgb, var(--warn) 50%, transparent)", fontFamily: "ui-monospace, monospace" }}>
                      {DAY_LABELS[c.weekday]} {c.hour}h · <strong style={{ color: "var(--good)" }}>{rateOf(c).toFixed(0)}%</strong> <span className="muted">({c.count})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* ─── VOLUME PAR CRÉNEAU (Matin / Midi / Soir / Hors) ─── */}
      {(() => {
        const maxSlot = Math.max(1, ...data.slots.map((s) => s.total));
        const best = [...data.slots].filter((s) => s.total >= 3).sort((a, b) => (b.answered / b.total) - (a.answered / a.total))[0];
        return (
          <div className="card">
            <h3 style={{ marginTop: 0, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}><Clock size={15} /> {t("Volume par créneau")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{t("Appels et taux de décroché · heure UK")}</p>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.slots.length}, 1fr)`, gap: 12 }}>
              {data.slots.map((s) => {
                const ar = s.total > 0 ? s.answered / s.total : 0;
                return (
                  <div key={s.key} style={{ display: "grid", gap: 6 }}>
                    <div style={{ height: 80, display: "flex", alignItems: "end", gap: 4 }}>
                      <div title={`${s.total} appels`} style={{ flex: 1, background: "var(--info)", height: `${(s.total / maxSlot) * 100}%`, minHeight: 2, borderRadius: 3 }} />
                      <div title={`${s.answered} décrochés`} style={{ flex: 1, background: "var(--good)", height: `${(s.answered / maxSlot) * 100}%`, minHeight: 2, borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}><strong>{s.total}</strong> · <span style={{ color: "var(--good)" }}>{pct(ar)}</span></div>
                  </div>
                );
              })}
            </div>
            {best && (
              <p style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                <Lightbulb size={15} style={{ verticalAlign: "middle" }} /> <strong style={{ color: "var(--accent)" }}>{t("Recommandation")} :</strong> {t("Meilleur taux de réponse sur")} <strong>{best.label}</strong> ({pct(best.answered / best.total)}). {t("Concentrer les prochains appels sur ce créneau.")}
              </p>
            )}
          </div>
        );
      })()}

      {/* ─── ELIGIBILITY PIPELINE (S2 UK NHS WMP) ─── */}
      {data.eligibility.eligible_total > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={15} /> {t("Pipeline d'éligibilité (S2 UK NHS WMP)")}</h3>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("BMI ≥ 40 (ou ≥ 35 avec comorbidité)")}</p>
            </div>
            <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 99, border: "1px solid color-mix(in srgb, var(--good) 50%, transparent)", color: "var(--good)" }}>
              {data.eligibility.eligible_total.toLocaleString()} {t("éligibles")} · {data.eligibility.total_leads.toLocaleString()} {t("total")}
            </span>
          </div>

          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--good)", margin: "12px 0 6px" }}>
            <Target size={15} style={{ verticalAlign: "middle" }} /> {t("Éligibles & encore dans le pipeline")} ({data.eligibility.pipeline_count})
          </div>
          {data.eligibility.in_pipeline.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>{t("Aucun éligible en attente.")}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="list" style={{ width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>{t("Patient")}</th>
                    <th style={{ textAlign: "right" }}>BMI</th>
                    <th style={{ textAlign: "left" }}>{t("Statut")}</th>
                    <th style={{ textAlign: "right" }}>{t("Appels")}</th>
                    <th style={{ textAlign: "left" }}>{t("Source")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eligibility.in_pipeline.map((p, i) => (
                    <tr key={`${p.phone}-${i}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.name ?? t("Inconnu")}</div>
                        <div className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{p.phone ?? "—"}</div>
                      </td>
                      <td style={{ textAlign: "right", color: "var(--good)", fontWeight: 600 }}>{p.bmi.toFixed(1)}</td>
                      <td>{p.status}</td>
                      <td style={{ textAlign: "right" }}>{p.calls}</td>
                      <td className="muted">{p.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.eligibility.pipeline_count > data.eligibility.in_pipeline.length && (
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              + {(data.eligibility.pipeline_count - data.eligibility.in_pipeline.length).toLocaleString()} {t("de plus — affine les filtres pour les voir.")}
            </p>
          )}

          {data.eligibility.lost_count > 0 && (
            <>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--warn)", margin: "14px 0 6px" }}>
                <AlertTriangle size={15} style={{ verticalAlign: "middle" }} /> {t("Éligibles mais perdus")} ({data.eligibility.lost_count.toLocaleString()}) — {t("revoir les raisons")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.eligibility.lost_sample.map((l, i) => (
                  <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)" }}>
                    {l.name ?? t("Inconnu")} · BMI {l.bmi.toFixed(1)} · <span style={{ color: "var(--warn)" }}>{l.reason}</span>
                  </span>
                ))}
                {data.eligibility.lost_count > data.eligibility.lost_sample.length && (
                  <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>+{(data.eligibility.lost_count - data.eligibility.lost_sample.length).toLocaleString()} {t("de plus")}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
