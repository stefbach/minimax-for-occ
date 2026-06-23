"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { AlertTriangle, FileText, Flame, Frown, Lightbulb, MessageSquare, Meh, Phone, Save, Smile, Sparkles, TrendingUp } from "lucide-react";
import { CallDetailPane } from "@/components/dashboard/CallDetailPane";
import type { DrillCall } from "@/app/api/dashboard/calls-drill/route";
import type { QualBucket } from "@/lib/qualification";
import type {
  InsightsResponse, InsightsResult, InsightsCallIndexEntry,
  StrategicAlert, ObjectionInsight, HotLead,
} from "@/lib/insights/types";

type Index = Record<string, InsightsCallIndexEntry>;

export function AiInsightsTab({
  from, to, direction, leadsSource, system, periodLabel, campaignId,
}: {
  from: string; to: string; direction: string;
  leadsSource: "prod" | "test"; system: "all" | "retell" | "axon"; periodLabel: string;
  campaignId?: string;
}) {
  const t = useT();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [openCall, setOpenCall] = useState<DrillCall | null>(null);

  // A change of period/filters invalidates the current report.
  useEffect(() => { setData(null); setStarted(false); setError(null); }, [from, to, direction, leadsSource, system, campaignId]);

  const run = useCallback(async (force: boolean) => {
    setLoading(true); setError(null); setStarted(true);
    try {
      const r = await fetch("/api/dashboard/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, direction, leads_source: leadsSource, system, period_label: periodLabel, campaign_id: campaignId, force_refresh: force }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j as InsightsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, [from, to, direction, leadsSource, system, periodLabel, campaignId]);

  const index: Index = data?.calls_index ?? {};
  const nameFor = (id: string) => index[id]?.name ?? `Call ${id.slice(0, 8)}`;
  const openById = (id: string) => {
    const e = index[id];
    if (!e) return;
    setOpenCall({
      id: e.id, started_at: e.started_at, direction: e.direction,
      duration_secs: e.duration_secs, answered: e.answered,
      qualification: e.qualification as QualBucket,
      contact_name: e.name, agent_name: null, phone: e.phone, disposition: null, assignee: null,
    });
  };

  // ── Gate (before first generation) ──
  if (!started && !data) {
    return (
      <div className="card" style={{ borderStyle: "dashed", display: "grid", gap: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <Sparkles size={18} /> {t("AI Insights — analyse stratégique")}
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {t("Génère un résumé exécutif, les objections fréquentes, les tendances émergentes, un audit du script et le climat de la période — à partir des résumés d'appels (DeepSeek).")}
        </p>
        <div style={{ background: "color-mix(in srgb, var(--muted) 10%, transparent)", borderRadius: 8, padding: 10, fontSize: 13 }}>
          <strong>{t("Période")}</strong> : {periodLabel} · ~10–30s {t("de génération")}
        </div>
        <div>
          <button onClick={() => run(false)} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
            <Sparkles size={15} style={{ verticalAlign: "middle" }} /> {t("Générer les insights")}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ borderColor: "var(--bad)", display: "grid", gap: 10, padding: 16 }}>
        <div style={{ color: "var(--bad)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={15} /> {t("Échec de la génération")}</div>
        <p style={{ fontSize: 13, margin: 0 }}>{error}</p>
        <div><button className="ghost" onClick={() => run(true)} style={{ padding: "6px 12px", fontSize: 13 }}>↺ {t("Réessayer")}</button></div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="card" style={{ display: "grid", gap: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <Sparkles size={18} className="pulse" /> {t("Analyse en cours…")}
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("L'IA lit les résumés de la période — patiente 15 à 60 secondes.")}</p>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: i === 0 ? 70 : 110, borderRadius: 8, background: "color-mix(in srgb, var(--muted) 12%, transparent)", animation: "ins-pulse 1.2s ease-in-out infinite" }} />
        ))}
        <style jsx>{`@keyframes ins-pulse{0%,100%{opacity:.4}50%{opacity:.7}} .pulse{animation:ins-pulse 1.2s ease-in-out infinite}`}</style>
      </div>
    );
  }

  const ins = data.insights;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Header insights={ins} onRefresh={() => run(true)} loading={loading} />

      {ins.strategic_alerts.length > 0 && <Alerts alerts={ins.strategic_alerts} />}

      <Pulse insights={ins} />

      <div className="duo-grid">
        <Objections objections={ins.objections} nameFor={nameFor} onOpen={openById} />
        <Trends trends={ins.trends} />
      </div>

      <div className="duo-grid">
        <ScriptAudit audit={ins.script_audit} nameFor={nameFor} onOpen={openById} />
        <Climate sentiment={ins.sentiment} index={index} onOpen={openById} />
      </div>

      {ins.optimization_hypotheses.length > 0 && <Hypotheses hypotheses={ins.optimization_hypotheses} />}

      <Chatbox from={from} to={to} direction={direction} leadsSource={leadsSource} system={system} periodLabel={periodLabel} />

      <p className="muted" style={{ fontSize: 11, fontStyle: "italic", textAlign: "center", margin: 0 }}>
        <AlertTriangle size={15} style={{ verticalAlign: "middle" }} /> {t("Les suggestions de l'IA sont des hypothèses à valider, pas des vérités. Les chiffres décrivent les données observées.")}
      </p>

      {/* Hot-lead / example detail overlay (reuses the drill-down pane). */}
      {openCall && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
          <button aria-label={t("Fermer")} onClick={() => setOpenCall(null)}
            style={{ position: "absolute", inset: 0, border: 0, padding: 0, cursor: "pointer", background: "color-mix(in srgb, black 45%, transparent)" }} />
          <aside style={{ position: "relative", width: "min(520px, 100vw)", height: "100%", background: "var(--bg)", borderLeft: "1px solid var(--border)", boxShadow: "-12px 0 32px rgba(0,0,0,.18)" }}>
            <CallDetailPane call={openCall} leadsSource={leadsSource} onBack={() => setOpenCall(null)} />
          </aside>
        </div>
      )}

      <style jsx>{`
        .duo-grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
        @media (min-width: 920px) { .duo-grid { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  );
}

// ─────────────────────────── sections ───────────────────────────

function Header({ insights, onRefresh, loading }: { insights: InsightsResult; onRefresh: () => void; loading: boolean }) {
  const t = useT();
  const g = new Date(insights.meta.generated_at);
  const hh = g.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}><Sparkles size={15} /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>AI Insights · {insights.meta.period_label}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {t("Généré")} {hh} · {insights.meta.calls_analysed} {t("appels")} · {(insights.meta.elapsed_ms / 1000).toFixed(1)}s · {insights.meta.model}
            {insights.meta.cached && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 99, fontSize: 10, background: "color-mix(in srgb, var(--muted) 18%, transparent)", display: "inline-flex", alignItems: "center", gap: 3 }}><Save size={10} /> {t("cache")}</span>}
          </div>
        </div>
      </div>
      <button className="ghost" onClick={onRefresh} disabled={loading} style={{ padding: "5px 12px", fontSize: 12 }}>↺ {t("Re-générer")}</button>
    </div>
  );
}

function Alerts({ alerts }: { alerts: StrategicAlert[] }) {
  const t = useT();
  const tone = (s: string) => s === "high" ? "var(--bad)" : s === "medium" ? "var(--warn)" : "var(--info, var(--accent))";
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {alerts.map((a, i) => {
        const c = tone(a.severity);
        return (
          <div key={i} className="card" style={{ display: "flex", gap: 10, padding: 12, borderColor: c, background: `color-mix(in srgb, ${c} 8%, transparent)` }}>
            <AlertTriangle size={15} style={{ color: c, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{a.message}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{a.evidence_count} {t("appels supportent ce signal")} · {t("sévérité")} {a.severity}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pulse({ insights }: { insights: InsightsResult }) {
  const t = useT();
  return (
    <div className="card" style={{ display: "grid", gap: 12, padding: 16, boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><Sparkles size={15} /> {t("Pulse de la période")}</div>
      <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{insights.pulse.summary}</p>
      {insights.pulse.highlights.length > 0 && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {insights.pulse.highlights.map((h, i) => (
            <div key={i} style={{ background: "color-mix(in srgb, var(--muted) 10%, transparent)", borderRadius: 8, padding: 10 }}>
              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{h.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{h.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{ padding: "2px 7px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "inherit", cursor: onClick ? "pointer" : "default", fontFamily: "ui-monospace, Menlo, monospace" }}>
      {children}
    </button>
  );
}

function SectionCard({ icon, title, desc, children }: { icon: ReactNode; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: "grid", gap: 12, padding: 16, alignContent: "start" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><span style={{ fontSize: 15 }}>{icon}</span> {title}</div>
        {desc && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Objections({ objections, nameFor, onOpen }: { objections: ObjectionInsight[]; nameFor: (id: string) => string; onOpen: (id: string) => void }) {
  const t = useT();
  const max = Math.max(...objections.map((o) => o.count || 0), 1);
  return (
    <SectionCard icon={<MessageSquare size={15} />} title={t("Top objections")} desc={t("Pourquoi les prospects refusent (avec suggestions à valider)")}>
      {objections.length === 0 ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("Aucune objection saillante.")}</p> : objections.map((o, i) => (
        <div key={i} style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{o.label}</span>
            <span className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{o.count} · {o.percent.toFixed(0)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "color-mix(in srgb, var(--muted) 18%, transparent)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(o.count / max) * 100}%`, background: "var(--bad)" }} />
          </div>
          <div className="muted" style={{ fontSize: 12, fontStyle: "italic", display: "flex", alignItems: "center", gap: 4 }}><Lightbulb size={12} /> <strong>{t("Suggestion à valider")}</strong> : {o.counter_argument}</div>
          {o.example_call_ids.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {o.example_call_ids.slice(0, 3).map((cid) => <Badge key={cid} onClick={() => onOpen(cid)}>{nameFor(cid)}</Badge>)}
            </div>
          )}
        </div>
      ))}
    </SectionCard>
  );
}

function Trends({ trends }: { trends: InsightsResult["trends"] }) {
  const t = useT();
  return (
    <SectionCard icon={<TrendingUp size={15} />} title={t("Tendances & signaux faibles")} desc={t("Sujets qui émergent dans les conversations")}>
      {trends.emerging_keywords.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>{t("Mots-clés émergents")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {trends.emerging_keywords.map((k, i) => (
              <span key={i} title={k.note} style={{ borderRadius: 99, padding: "3px 9px", fontSize: 12, border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
                <strong>{k.keyword}</strong> <span style={{ color: "var(--accent)", fontFamily: "ui-monospace, monospace" }}>×{k.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {trends.weak_signals.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, margin: "8px 0 6px" }}>{t("Signaux faibles")}</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 5, fontSize: 13 }}>
            {trends.weak_signals.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {trends.emerging_keywords.length === 0 && trends.weak_signals.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("Aucune tendance saillante.")}</p>}
    </SectionCard>
  );
}

function ScriptAudit({ audit, nameFor, onOpen }: { audit: InsightsResult["script_audit"]; nameFor: (id: string) => string; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <SectionCard icon={<FileText size={15} />} title={t("Audit du script")} desc={t("Thèmes de raccrochage + phrases sur-représentées dans les appels gagnés")}>
      {audit.common_hangup_topics.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>{t("Au moment du raccrochage…")}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {audit.common_hangup_topics.map((tp, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div>{tp.topic}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {tp.example_call_ids.slice(0, 3).map((cid) => <Badge key={cid} onClick={() => onOpen(cid)}>{nameFor(cid)}</Badge>)}
                  </div>
                </div>
                <span className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, flexShrink: 0 }}>×{tp.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {audit.converted_call_patterns.length > 0 && (
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, margin: "8px 0 6px", color: "var(--good)" }}>{t("Sur-représenté dans les RDV obtenus")}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {audit.converted_call_patterns.map((p, i) => (
              <div key={i} style={{ borderRadius: 8, padding: 8, border: "1px solid color-mix(in srgb, var(--good) 25%, transparent)", background: "color-mix(in srgb, var(--good) 6%, transparent)" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.phrase_or_theme}</div>
                <div className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>{p.frequency_in_won}× {t("dans les gagnés")} · {p.frequency_in_lost}× {t("dans les perdus")}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {audit.common_hangup_topics.length === 0 && audit.converted_call_patterns.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("Données insuffisantes pour cet audit.")}</p>}
    </SectionCard>
  );
}

function Climate({ sentiment, index, onOpen }: { sentiment: InsightsResult["sentiment"]; index: Index; onOpen: (id: string) => void }) {
  const t = useT();
  const d = sentiment.distribution;
  const total = (d.positive || 0) + (d.neutral || 0) + (d.negative || 0);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const Bar = ({ icon, label, n, color }: { icon: ReactNode; label: string; n: number; color: string }) => (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{icon} {label}</span><span className="muted" style={{ fontFamily: "ui-monospace, monospace" }}>{n} ({pct(n).toFixed(0)}%)</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "color-mix(in srgb, var(--muted) 18%, transparent)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct(n)}%`, background: color }} />
      </div>
    </div>
  );
  return (
    <SectionCard icon={<Flame size={15} />} title={t("Climat & hot leads")} desc={t("Score moyen + prospects à rappeler en priorité")}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{sentiment.average_score.toFixed(1)}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/10</span></div>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase" }}>{t("Score moyen")}</div>
        </div>
        <div style={{ flex: 1, display: "grid", gap: 6 }}>
          <Bar icon={<Smile size={14} />} label={t("Positif")} n={d.positive || 0} color="var(--good)" />
          <Bar icon={<Meh size={14} />} label={t("Neutre")} n={d.neutral || 0} color="var(--info, var(--accent))" />
          <Bar icon={<Frown size={14} />} label={t("Négatif")} n={d.negative || 0} color="var(--bad)" />
        </div>
      </div>
      {sentiment.hot_leads.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><Phone size={14} /> {t("Hot leads à rappeler humainement")}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {sentiment.hot_leads.map((hl: HotLead) => {
              const e = index[hl.call_id];
              return (
                <button key={hl.call_id} type="button" onClick={() => onOpen(hl.call_id)}
                  style={{ textAlign: "left", width: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 8%, transparent)", padding: 8, cursor: "pointer", color: "inherit" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {e?.name ?? `Call ${hl.call_id.slice(0, 8)}`}
                    {e?.phone && <span className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", marginLeft: 8 }}>{e.phone}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{hl.reason}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function Hypotheses({ hypotheses }: { hypotheses: InsightsResult["optimization_hypotheses"] }) {
  const t = useT();
  return (
    <div className="card" style={{ display: "grid", gap: 12, padding: 16, borderColor: "color-mix(in srgb, var(--accent) 30%, var(--border))" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><Lightbulb size={15} /> {t("Hypothèses à tester")}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("Pistes d'optimisation basées sur les données — à valider par A/B test, jamais à prendre pour vérité.")}</div>
      </div>
      {hypotheses.map((h, i) => (
        <div key={i} style={{ borderRadius: 8, border: "1px solid var(--border)", padding: 12, display: "grid", gap: 6, background: "color-mix(in srgb, var(--bg) 60%, transparent)" }}>
          <div style={{ fontSize: 13 }}><strong style={{ color: "var(--accent)" }}>{t("Observation")} :</strong> {h.observation}</div>
          <div style={{ fontSize: 13 }}><strong style={{ color: "var(--good)" }}>{t("Test à mener")} :</strong> {h.test_to_run}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Q&A chat ───────────────────────────

type ChatTurn = { role: "user" | "assistant"; content: string };

function Chatbox({ from, to, direction, leadsSource, system, periodLabel }: {
  from: string; to: string; direction: string; leadsSource: "prod" | "test"; system: "all" | "retell" | "axon"; periodLabel: string;
}) {
  const t = useT();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const suggestions = [
    t("Quel est mon hot lead le plus chaud à rappeler en priorité ?"),
    t("Résume-moi les objections liées au coût"),
    t("Quels appels mentionnent le conjoint comme frein ?"),
    t("Donne-moi 3 patterns observés dans les appels RDV"),
  ];

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...turns, { role: "user" as const, content: q }];
    setTurns(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/dashboard/insights/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, from, to, direction, leads_source: leadsSource, system, period_label: periodLabel }),
      });
      const j = await r.json();
      const reply = r.ok ? (j.reply ?? "—") : `⚠️ ${j.error ?? `HTTP ${r.status}`}`;
      setTurns((cur) => [...cur, { role: "assistant", content: reply }]);
    } catch (e) {
      setTurns((cur) => [...cur, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "error"}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 50);
    }
  }, [turns, busy, from, to, direction, leadsSource, system, periodLabel]);

  return (
    <div className="card" style={{ display: "grid", gap: 10, padding: 16, borderColor: "color-mix(in srgb, var(--accent) 30%, var(--border))" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><MessageSquare size={15} /> {t("Pose une question à l'IA")}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("L'IA voit les appels de la période et peut chercher dans les résumés à la demande.")}</div>
      </div>

      {turns.length > 0 && (
        <div ref={scroller} style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 8, paddingRight: 4 }}>
          {turns.map((m, i) => (
            <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap",
              background: m.role === "user" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "color-mix(in srgb, var(--muted) 12%, transparent)" }}>
              {m.content}
            </div>
          ))}
          {busy && <div className="muted" style={{ fontSize: 12 }}>{t("L'IA réfléchit…")}</div>}
        </div>
      )}

      {turns.length === 0 && (
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {suggestions.map((s, i) => (
            <button key={i} type="button" className="ghost" onClick={() => send(s)} style={{ textAlign: "left", padding: "8px 10px", fontSize: 12 }}>{s}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(input); }}
          placeholder={t("Pose ta question… (Cmd/Ctrl + Entrée pour envoyer)")}
          rows={2}
          style={{ flex: 1, padding: "8px 10px", fontSize: 13, resize: "vertical" }}
        />
        <button onClick={() => send(input)} disabled={busy || !input.trim()} style={{ padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap" }}>➤ {t("Envoyer")}</button>
      </div>
    </div>
  );
}
