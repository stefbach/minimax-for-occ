"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DirectorResponse } from "@/app/api/dashboard/director/route";
import type { QualBucket } from "@/lib/qualification";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarCheck, CheckCircle2, Link2, Moon, Phone, Sparkles, Sunrise, Sun, Sunset, Tag, Timer, TrendingUp } from "lucide-react";
import { useT } from "@/lib/i18n";
import { DrillSheet, type DrillFilters, type DrillSpec } from "./DrillSheet";
import { SLOT_WINDOWS } from "@/lib/call-slots";
import { appendGlobalFilters, globalFiltersKey, globalFilterParams, DEFAULT_GLOBAL_FILTERS, type GlobalFilters } from "@/lib/global-filters";

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Unambiguous 24h DD/MM HH:MM in the user's local timezone. Replaces
  // the previous "Jun 04, 5:16 PM" format which a Mauritius user (UTC+4)
  // confused for UTC because it didn't show seconds or TZ.
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

// Date-only DD/MM/YYYY, used to label the analysed period and the phases
// "as of" stamp. Kept separate from fmtDate (which adds the time) so the
// period range stays compact.
function fmtDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

const THRESHOLD_OPTIONS = [60, 120, 180, 300, 600];

// Card that behaves like a button: keyboard focusable, hover lift, accessible.
// Keeps the visual identical to the existing `.card` so the layout doesn't
// shift — we just add interactivity on top.
function ClickCard({
  onClick,
  ariaLabel,
  style,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="card"
      style={{
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        transition: "transform 120ms, box-shadow 120ms, border-color 120ms",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      {children}
    </button>
  );
}

export function DirectorTab({ from, to, direction, leadsSource = "prod", system = "all", slot = "all", global = DEFAULT_GLOBAL_FILTERS, refreshKey = 0, campaignId }: { from: string; to: string; direction: string; leadsSource?: "prod" | "test"; system?: "all" | "retell" | "axon"; slot?: "all" | "morning" | "afternoon" | "evening"; global?: GlobalFilters; refreshKey?: number; campaignId?: string }) {
  const t = useT();
  const [data, setData] = useState<DirectorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(60);
  const [activeQualTab, setActiveQualTab] = useState<string>("all");
  // Bumped after an AI-qualification run so the director figures refetch.
  const [reloadKey, setReloadKey] = useState(0);
  const [qualifying, setQualifying] = useState(false);
  const [qualifyMsg, setQualifyMsg] = useState<string | null>(null);
  // Drill-down: which card was clicked. null = sheet closed.
  const [drill, setDrill] = useState<DrillSpec | null>(null);

  // Every card opens the SAME sheet — passes the current period + direction +
  // leads source + calling-system, plus the per-card filter. Keeps all scoping
  // consistent between the KPI and its drill-down.
  const openDrill = (
    title: string,
    icon: string,
    tone: string,
    extra: Omit<DrillFilters, "from" | "to" | "direction" | "leads_source" | "system">,
    subtitle?: string,
  ) => {
    const filters: DrillFilters = {
      from, to,
      direction: direction === "all" ? undefined : direction,
      leads_source: leadsSource,
      system: system === "all" ? undefined : system,
      // Global bar filters ride along so the drill list matches the card's
      // (already filtered) count.
      gf: globalFilterParams(global),
      ...extra,
    };
    setDrill({ title, subtitle, icon, tone, filters });
  };

  const gfKey = globalFiltersKey(global);
  // Token-based cancellation: each call to loadDirector() bumps the token, and
  // any in-flight fetch from a prior call ignores its own response. This lets
  // both the deps-driven useEffect AND the DrillSheet `onClosed` callback share
  // the same loader without racing each other (last-writer-wins on data).
  const loadTokenRef = useRef(0);
  const loadDirector = useCallback(() => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    const qs = new URLSearchParams({ from, to, threshold: String(threshold), leads_source: leadsSource });
    if (direction !== "all") qs.set("direction", direction);
    if (system !== "all") qs.set("system", system);
    if (slot !== "all") qs.set("slot", slot);
    if (campaignId && campaignId !== "all") qs.set("campaign_id", campaignId);
    appendGlobalFilters(qs, global);
    fetch(`/api/dashboard/director?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (loadTokenRef.current === token) { setData(j); setError(null); }
      })
      .catch((e) => {
        if (loadTokenRef.current === token) setError(e instanceof Error ? e.message : "error");
      })
      .finally(() => {
        if (loadTokenRef.current === token) setLoading(false);
      });
  }, [from, to, direction, threshold, leadsSource, system, slot, global, campaignId]);

  useEffect(() => {
    loadDirector();
    // Bumping the token in the cleanup invalidates the in-flight fetch when
    // deps change before it resolves — same effect as the previous `alive` flag.
    return () => { loadTokenRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, direction, threshold, leadsSource, system, slot, gfKey, reloadKey, refreshKey, campaignId]);

  // AI qualification is automatic: any answered call left in the "autre" bucket
  // is classified by the AI from its transcript. New calls are handled at
  // ingestion (Retell webhook + sync); this drains any pre-existing backlog in
  // the background when the dashboard is viewed — no button. Bounded per batch
  // server-side, so we loop until the backlog is cleared (or stops shrinking).
  const drainedSigRef = useRef<string>("");

  useEffect(() => {
    if (!data || (data.pendingAnalysis ?? data.unqualified) <= 0) return;
    const sig = `${from}|${to}|${leadsSource}|${system}`;
    if (drainedSigRef.current === sig) return; // already attempted this view
    drainedSigRef.current = sig;
    let cancelled = false;

    (async () => {
      setQualifying(true);
      let madeProgress = false;
      // Track the backlog size across batches: progress = the candidate count
      // (pending_before) shrinking. We can't key off "qualified", because calls
      // that only needed agent-stage detection (already qualified) report
      // qualified=0 yet still made progress.
      let lastPending = Infinity;
      try {
        for (let iter = 0; iter < 60 && !cancelled; iter++) {
          const qs = new URLSearchParams({ leads_source: leadsSource });
          if (system !== "all") qs.set("system", system);
          const r = await fetch(`/api/dashboard/qualify-unqualified?${qs}`, { method: "POST" });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
          const pending = Number(j.pending_before ?? 0);
          const processed = Number(j.processed ?? 0);
          if (processed > 0) madeProgress = true;
          setQualifyMsg(`✨ ${t("Analyse IA automatique")} · ${Math.max(0, pending - processed)} ${t("restant(s)")}`);
          if (pending <= 0 || processed === 0) break;     // nothing left to do
          if (pending >= lastPending) break;              // last batch resolved nothing → stuck
          lastPending = pending;
        }
      } catch (e) {
        if (!cancelled) setQualifyMsg(e instanceof Error ? e.message : "error");
      } finally {
        if (!cancelled) {
          setQualifying(false);
          setQualifyMsg(null);
          if (madeProgress) setReloadKey((k) => k + 1);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [data, from, to, leadsSource, system, t]);

  const summariesByQual = useMemo(() => {
    const m = new Map<string, DirectorResponse["summaries"]>();
    if (!data) return m;
    for (const s of data.summaries) {
      if (!m.has(s.qualification)) m.set(s.qualification, []);
      m.get(s.qualification)!.push(s);
    }
    return m;
  }, [data]);

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;
  const k = data.kpis;

  type Tile = {
    label: string;
    value: string;
    icon: string;
    displayIcon: ReactNode;
    tone?: string;
    highlight?: boolean;
    // null means the card isn't drillable (e.g. derived ratios) — disable the click.
    drill: Omit<DrillFilters, "from" | "to" | "direction" | "leads_source"> | null;
  };
  const tiles: Tile[] = [
    { label: t("Total appels"), value: k.totalCalls.toLocaleString(), icon: "📞", displayIcon: <Phone size={15} />, tone: "var(--info)", drill: {} },
    { label: t("Décrochés"), value: `${k.answered.toLocaleString()} · ${k.answeredPct.toFixed(0)}%`, icon: "✅", displayIcon: <CheckCircle2 size={15} />, tone: "var(--good)", drill: { answered: "yes" } },
    // Cost is an aggregate over usage_events, not a call subset → no drill.
    // Drill = every call in the period (each one contributed to the spend),
    // mirroring the legacy "Cost consumed" panel.
    { label: t("Coût consommé"), value: `$${k.cost.toFixed(2)}`, icon: "$", displayIcon: <span>$</span>, tone: "var(--warn)", drill: {} },
    { label: t("RDV confirmés"), value: k.rdvConfirmed.toLocaleString(), icon: "📅", displayIcon: <CalendarCheck size={15} />, tone: "var(--good)", highlight: true, drill: { qualification: "rdv_confirme" } },
    // Conversion = RDV / Total → drill to the RDV calls (the numerator).
    { label: t("Taux de conversion"), value: `${k.conversionRate.toFixed(1)}%`, icon: "📈", displayIcon: <TrendingUp size={15} />, tone: "var(--accent-2)", drill: { qualification: "rdv_confirme" } },
    { label: t("Durée moyenne"), value: fmtDur(k.avgDuration), icon: "⏱", displayIcon: <Timer size={15} />, tone: "var(--info)", drill: { answered: "yes" } },
    { label: t("Callbacks demandés"), value: k.callbacks.toLocaleString(), icon: "↺", displayIcon: <span>↺</span>, tone: "var(--accent)", drill: { qualification: "rappel" } },
    { label: `${t("Durée")} > ${k.threshold}s`, value: k.callsOverThreshold.toLocaleString(), icon: "⧖", displayIcon: <span>⧖</span>, tone: "var(--muted)", drill: { min_duration: k.threshold } },
  ];

  type TotalCard = { label: string; value: number; tone: string; drill: Omit<DrillFilters, "from" | "to" | "direction" | "leads_source"> };
  const totalsCards: TotalCard[] = [
    { label: t("Total appels"), value: k.totalCalls, tone: "var(--info)", drill: {} },
    { label: t("Décrochés"), value: k.answered, tone: "var(--good)", drill: { answered: "yes" } },
    { label: t("Non décrochés"), value: k.notAnswered, tone: "var(--bad)", drill: { answered: "no" } },
  ];

  const visibleSummaries = activeQualTab === "all"
    ? data.summaries
    : (summariesByQual.get(activeQualTab) ?? []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* KPI ROW */}
      <div className="grid-kpi">
        {tiles.map((tile) => {
          const inner = (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center" }}>{tile.displayIcon}</span>
                <span className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>{tile.label}</span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8, color: tile.tone }}>{tile.value}</div>
            </>
          );
          if (!tile.drill) {
            return (
              <div key={tile.label} className="card" style={{ padding: 16, borderColor: tile.highlight ? "var(--good)" : undefined }}>
                {inner}
              </div>
            );
          }
          return (
            <ClickCard
              key={tile.label}
              ariaLabel={`${tile.label} — ${t("voir les appels")}`}
              onClick={() => openDrill(tile.label, tile.icon, tile.tone ?? "var(--accent)", tile.drill!)}
              style={{ padding: 16, borderColor: tile.highlight ? "var(--good)" : undefined }}
            >
              {inner}
            </ClickCard>
          );
        })}
      </div>

      {/* THRESHOLD CHIP ROW — controls the "Durée > X" KPI tile above. */}
      <div
        className="card"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 12 }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          {t("Seuil « appel qualitatif »")}
          <span className="muted" style={{ fontWeight: 400 }}> · {t("durée minimum")} :</span>
        </span>
        {THRESHOLD_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={threshold === s ? "" : "ghost"}
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => setThreshold(s)}
          >
            {s < 60 ? `${s}s` : `${s / 60} min`}
          </button>
        ))}
        <span
          style={{
            marginLeft: 8, fontSize: 13, padding: "4px 10px",
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            color: "var(--accent)", borderRadius: 6, fontWeight: 600,
          }}
        >
          ⧖ {k.callsOverThreshold} {t("appel(s)")} {">"} {threshold < 60 ? `${threshold}s` : `${threshold / 60} min`}
        </span>
        <div className="muted" style={{ fontSize: 11, flex: 1, minWidth: 200 }}>
          {t("Filtre la tuile « DURÉE > X » ci-dessus. Les autres KPI ne changent pas.")}
        </div>
      </div>

      {/* TOTALS STRIP */}
      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {totalsCards.map((c) => (
          <ClickCard
            key={c.label}
            ariaLabel={`${c.label} — ${t("voir les appels")}`}
            onClick={() => openDrill(c.label, "phone", c.tone, c.drill)}
            style={{ padding: 16 }}
          >
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: c.tone }}>{c.value.toLocaleString()}</div>
          </ClickCard>
        ))}
      </div>

      {/* QUALIFICATIONS GRID — 9 fixed cards */}
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>{t("Qualifications")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Source")} : <code>calls.metadata.qualification</code> + <code>calls.disposition</code>
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {data.qualifications.map((q) => (
            <ClickCard
              key={q.key}
              ariaLabel={`${q.label} — ${t("voir les appels")}`}
              onClick={() => openDrill(q.label, "tag", "var(--accent)", { qualification: q.key as QualBucket })}
              style={{ padding: 12, textAlign: "center", borderColor: q.count > 0 ? "var(--accent)" : undefined }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: q.count > 0 ? "var(--accent)" : "var(--muted)" }}>
                {q.count}
              </div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 }}>
                {q.label}
              </div>
            </ClickCard>
          ))}
        </div>

        {/* Answered-but-unqualified calls — visible instead of silently dropped,
            with a one-click AI pass to slot them into the right card. The count
            itself is clickable to drill into the offending calls. */}
        {data.unqualified > 0 && (
          <div
            style={{
              marginTop: 12, padding: 12, borderRadius: 8,
              border: "1px solid var(--warn)",
              background: "color-mix(in srgb, var(--warn) 8%, transparent)",
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => openDrill(t("Appels décrochés non qualifiés"), "alert", "var(--warn)", { qualification: "unqualified" })}
              aria-label={t("Voir les appels non qualifiés")}
              style={{
                fontSize: 22, fontWeight: 700, color: "var(--warn)",
                background: "transparent", border: "none", padding: 0, cursor: "pointer",
              }}
            >
              {data.unqualified}
            </button>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {t("Appels décrochés non qualifiés")}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {t("Qualification IA automatique : chaque appel décroché est classé par l'IA d'après son transcript. Le reliquat se résorbe tout seul.")}
              </div>
            </div>
            <span className="muted" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {qualifying && <Sparkles size={14} className="ai-spin" aria-hidden />}
              {qualifying
                ? (qualifyMsg ?? t("Qualification IA en cours…"))
                : (qualifyMsg ?? <><Sparkles size={14} style={{ verticalAlign: "middle" }} /> {t("Qualification IA automatique")}</>)}
            </span>
          </div>
        )}
        <style jsx>{`@keyframes ai-spin-kf{0%,100%{opacity:.45}50%{opacity:1}} .ai-spin{animation:ai-spin-kf 1s ease-in-out infinite}`}</style>
      </div>

      {/* APPELS ENTRANTS — each figure drills into the matching call list. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Appels entrants")}</h3>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => openDrill(t("Appels entrants"), "inbound", "var(--info)", { inbound_only: true })}
            aria-label={t("Voir tous les entrants")}
            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--info)" }}>{data.inbound.total}</div>
            <div className="muted" style={{ fontSize: 11 }}>{t("Total")}</div>
          </button>
          <div className="muted" style={{ fontSize: 13, display: "inline-flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => openDrill(t("Entrants décrochés"), "check", "var(--good)", { inbound_only: true, answered: "yes" })}
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--good)" }}
            >
              {data.inbound.answered} {t("décrochés")}
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => openDrill(t("Entrants sans réponse"), "✕", "var(--bad)", { inbound_only: true, answered: "no" })}
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--bad)" }}
            >
              {data.inbound.notAnswered} {t("sans réponse")}
            </button>
          </div>
        </div>
      </div>

      {/* SUIVI J1 / J3 / J5 + CRÉNEAUX */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 2 }}>{t("Suivi J1 / J3 / J5")}</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 0 }}>
              {t("Relances programmées par phase et répartition des appels par créneau")}
            </p>
          </div>
          {data.hints.phasesAvailable && (
            <div style={{ textAlign: "right", fontSize: 11 }} className="muted">
              <div>
                {t("Pipeline au")} <strong style={{ color: "var(--text)" }}>{fmtDay(data.phaseContext.asOf)}</strong>
              </div>
              <div>{data.phaseContext.totalLeads.toLocaleString("fr-FR")} {t("leads au total")}</div>
            </div>
          )}
        </div>

        {data.hints.phasesAvailable ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 12 }}>
              {([
                ["RAPPEL", data.phases.rappel, t("Leads marqués « à rappeler »")],
                ["J1", data.phases.j1, t("Relance prévue à J+1")],
                ["J3", data.phases.j3, t("Relance prévue à J+3")],
                ["J5", data.phases.j5, t("Relance prévue à J+5")],
              ] as const).map(([label, p, desc]) => (
                <div key={label} className="card" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 11, letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 1, lineHeight: 1.3 }}>{desc}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{p.leads.toLocaleString("fr-FR")} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>leads</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{p.calls.toLocaleString("fr-FR")} {t("appels")}</div>
                  {/* Date breakdown: where each lead's scheduled call sits vs today. */}
                  <div style={{ display: "flex", gap: 4, marginTop: 8, fontSize: 10, flexWrap: "wrap" }}>
                    <span title={t("À appeler aujourd'hui")} style={{ padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", fontWeight: 600 }}>
                      {p.dueToday} {t("auj.")}
                    </span>
                    <span title={t("Date de relance dépassée")} style={{ padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", fontWeight: 600 }}>
                      {p.overdue} {t("en retard")}
                    </span>
                    <span title={t("Relance à venir")} className="muted" style={{ padding: "2px 6px", borderRadius: 4, background: "var(--bg-2)" }}>
                      {p.upcoming} {t("à venir")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0, fontStyle: "italic" }}>
              {t("Les volumes par phase couvrent l'ensemble du pipeline (indépendant de la période sélectionnée).")}
            </p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            {t("Aucune table de phases configurée pour cette organisation.")}
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{t("Par créneau d'appel")}</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              {t("Période")} : {fmtDay(data.phaseContext.period.from)} – {fmtDay(data.phaseContext.period.to)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {([
              ["Créneau 1 — matin", SLOT_WINDOWS.matin, data.slots.matin, "matin", "matin", <Sunrise size={13} />],
              ["Créneau 2 — midi", SLOT_WINDOWS.midi, data.slots.midi, "midi", "midi", <Sun size={13} />],
              ["Créneau 3 — soir", SLOT_WINDOWS.soir, data.slots.soir, "soir", "soir", <Sunset size={13} />],
              ["Hors créneau", null, data.slots.hors, "hors", "hors", <Moon size={13} />],
            ] as const).map(([label, win, v, slot, iconStr, displayIcon]) => {
              const slotTotal = data.slots.matin + data.slots.midi + data.slots.soir + data.slots.hors;
              const pct = slotTotal ? Math.round((v / slotTotal) * 100) : 0;
              return (
                <ClickCard
                  key={label}
                  ariaLabel={`${label} — ${t("voir les appels")}`}
                  onClick={() => openDrill(label, iconStr, "var(--accent)", { slot })}
                  style={{ padding: 10 }}
                >
                  <div className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>{displayIcon} {label}</div>
                  <div className="muted" style={{ fontSize: 10 }}>
                    {win ? `${win.uk} UK · ${win.mu} MU` : t("autres heures")}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                    {v.toLocaleString("fr-FR")} <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>· {pct}%</span>
                  </div>
                </ClickCard>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0, fontStyle: "italic" }}>
            {t("Fenêtres d'appel Lun–Jeu. Vendredi : créneau matin élargi à 08h–11h UK, pas de midi/soir. Week-end : hors créneau.")}
          </p>
        </div>
      </div>

      {/* CHAÎNE D'AGENTS */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Chaîne d'agents")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {t("Combien de leads sont passés sur 1, 2 ou 3 agents")}
          {qualifying && (
            <span style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Sparkles size={14} className="ai-spin" aria-hidden /> {qualifyMsg ?? t("Analyse IA automatique…")}
            </span>
          )}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {([
            ["Agent 1 uniquement", data.agentChain.only1, 1],
            ["Agent 1 → Agent 2", data.agentChain.plus2, 2],
            ["Agent 1 → 2 → 3", data.agentChain.plus3, 3],
          ] as const).map(([label, v, stage]) => (
            <button
              key={label}
              type="button"
              className="card"
              onClick={() => openDrill(t(label), "link", "var(--accent)", { agent_stage: stage as 1 | 2 | 3 })}
              aria-label={`${t("Voir les appels")} — ${t(label)}`}
              style={{ padding: 12, textAlign: "left", cursor: "pointer", color: "inherit" }}
            >
              <div className="muted" style={{ fontSize: 11 }}>{t(label)}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{v}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ANALYSE: DURATIONS + WHAT THEY SAID */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Distribution des durées")}</h3>
          {([
            ["< 15s", data.durationBuckets.lt15s, "lt15s"],
            ["15s - 1min", data.durationBuckets.s15_60, "s15_60"],
            ["1 - 2min", data.durationBuckets.m1_2, "m1_2"],
            ["2 - 3min", data.durationBuckets.m2_3, "m2_3"],
            ["3 - 5min", data.durationBuckets.m3_5, "m3_5"],
            ["> 5min", data.durationBuckets.gt5m, "gt5m"],
          ] as const).map(([label, v, bucket]) => {
            const max = Math.max(1, ...Object.values(data.durationBuckets));
            return (
              <button
                key={label}
                type="button"
                onClick={() => openDrill(`${t("Durée")} ${label}`, "timer", "var(--accent)", { duration_bucket: bucket })}
                aria-label={`${t("Durée")} ${label} — ${t("voir les appels")}`}
                style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
                  width: "100%", padding: "4px 6px", borderRadius: 6,
                  background: "transparent", border: "1px solid transparent", cursor: "pointer",
                  font: "inherit", color: "inherit", textAlign: "left",
                  transition: "background 120ms, border-color 120ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 6%, transparent)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }}
              >
                <span style={{ fontSize: 12, minWidth: 80 }}>{label}</span>
                <div style={{ flex: 1, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 14 }}>
                  <div style={{ width: `${(v / max) * 100}%`, height: "100%", background: "var(--accent)" }} />
                </div>
                <span className="muted" style={{ fontSize: 12, minWidth: 36, textAlign: "right" }}>{v}</span>
              </button>
            );
          })}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("Ce qu'ils ont dit")}</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {t("Résumés d'appels regroupés par qualification")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              className={activeQualTab === "all" ? "" : "ghost"}
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => setActiveQualTab("all")}
            >
              {t("Tous")} ({data.summaries.length})
            </button>
            {data.qualifications.filter((q) => (summariesByQual.get(q.key) ?? []).length > 0).map((q) => (
              <button
                key={q.key}
                type="button"
                className={activeQualTab === q.key ? "" : "ghost"}
                style={{ padding: "3px 10px", fontSize: 12 }}
                onClick={() => setActiveQualTab(q.key)}
              >
                {q.label} ({(summariesByQual.get(q.key) ?? []).length})
              </button>
            ))}
          </div>
          {visibleSummaries.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {data.hints.summariesAvailable
                ? t("Aucun résumé pour cette qualification.")
                : t("Aucun résumé d'appel sur la période. Les résumés sont générés post-appel.")}
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 460, overflowY: "auto" }}>
              {visibleSummaries.map((s) => (
                <div key={s.call_id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{s.contact_name ?? "—"}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{fmtDate(s.started_at)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {s.qualification_label} · {s.agent_name ?? "—"} · {fmtDur(s.duration)}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{s.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DOSSIERS À CONFIER À UN HUMAIN */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Dossiers à confier à un humain")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Leads en attente de rappel humain")} · <code>human_callback_tasks</code>
        </p>
        {data.humanCallbacks.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{t("Aucun dossier en attente.")}</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {data.humanCallbacks.map((h) => (
              <div
                key={h.task_id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6,
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {h.contact_name ?? "—"} <span className="muted" style={{ fontWeight: 400 }}>{h.phone ?? ""}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {h.qualification ?? "À passer à l'humain"}
                    {h.scheduled_for && ` · ${fmtDate(h.scheduled_for)}`}
                    {h.status && ` · ${h.status}`}
                  </div>
                </div>
                <a
                  href={`/desk?task=${h.task_id}`}
                  className="ghost"
                  style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none" }}
                >
                  {t("Voir dans Mon poste")} →
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
      <DrillSheet
        spec={drill}
        onClose={() => setDrill(null)}
        // Refresh the KPI tiles after the drill panel closes — calls may have
        // been re-qualified or modified while the user was inspecting the list,
        // and the tiles otherwise stay frozen on the data fetched at mount.
        onClosed={loadDirector}
      />
    </div>
  );
}
