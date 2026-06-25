"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DirectorResponse } from "@/app/api/dashboard/director/route";
import type { QualBucket } from "@/lib/qualification";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarCheck, CheckCircle2, Link2, Moon, Phone, Sparkles, Sunrise, Sun, Sunset, Tag, Timer, TrendingUp } from "lucide-react";
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
  return d.toLocaleString(undefined, {
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
  return d.toLocaleDateString(undefined, {
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
          setQualifyMsg(`✨ Automatic AI analysis · ${Math.max(0, pending - processed)} remaining`);
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
  }, [data, from, to, leadsSource, system]);

  const summariesByQual = useMemo(() => {
    const m = new Map<string, DirectorResponse["summaries"]>();
    if (!data) return m;
    for (const s of data.summaries) {
      if (!m.has(s.qualification)) m.set(s.qualification, []);
      m.get(s.qualification)!.push(s);
    }
    return m;
  }, [data]);

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;
  const k = data.kpis;

  // Returns "X%" of totalCalls, or "—" when there are no calls to divide by.
  function pct(n: number, decimals = 1): string {
    if (!k.totalCalls) return "—";
    return `${((n / k.totalCalls) * 100).toFixed(decimals)}%`;
  }

  type Tile = {
    label: string;
    value: string;
    icon: string;
    displayIcon: ReactNode;
    tone?: string;
    highlight?: boolean;
    // Percentage of totalCalls to show below the main value. null = omit.
    pctLabel?: string;
    // null means the card isn't drillable (e.g. derived ratios) — disable the click.
    drill: Omit<DrillFilters, "from" | "to" | "direction" | "leads_source"> | null;
  };
  const tiles: Tile[] = [
    { label: "Total calls", value: k.totalCalls.toLocaleString(), icon: "📞", displayIcon: <Phone size={15} />, tone: "var(--info)", pctLabel: "100%", drill: {} },
    { label: "Answered", value: `${k.answered.toLocaleString()} · ${k.answeredPct.toFixed(0)}%`, icon: "✅", displayIcon: <CheckCircle2 size={15} />, tone: "var(--good)", drill: { answered: "yes" } },
    // Cost is an aggregate over usage_events, not a call subset → no drill.
    // Drill = every call in the period (each one contributed to the spend),
    // mirroring the legacy "Cost consumed" panel.
    { label: "Cost spent", value: `$${k.cost.toFixed(2)}`, icon: "$", displayIcon: <span>$</span>, tone: "var(--warn)", drill: {} },
    { label: "Booked appts", value: k.rdvConfirmed.toLocaleString(), icon: "📅", displayIcon: <CalendarCheck size={15} />, tone: "var(--good)", highlight: true, pctLabel: pct(k.rdvConfirmed), drill: { qualification: "rdv_confirme" } },
    // Conversion = RDV / Total → drill to the RDV calls (the numerator).
    { label: "Conversion rate", value: `${k.conversionRate.toFixed(1)}%`, icon: "📈", displayIcon: <TrendingUp size={15} />, tone: "var(--accent-2)", drill: { qualification: "rdv_confirme" } },
    { label: "Avg duration", value: fmtDur(k.avgDuration), icon: "⏱", displayIcon: <Timer size={15} />, tone: "var(--info)", drill: { answered: "yes" } },
    { label: "Callbacks requested", value: k.callbacks.toLocaleString(), icon: "↺", displayIcon: <span>↺</span>, tone: "var(--accent)", pctLabel: pct(k.callbacks), drill: { qualification: "rappel" } },
    { label: `Duration > ${k.threshold}s`, value: k.callsOverThreshold.toLocaleString(), icon: "⧖", displayIcon: <span>⧖</span>, tone: "var(--muted)", pctLabel: pct(k.callsOverThreshold), drill: { min_duration: k.threshold } },
  ];

  type TotalCard = { label: string; value: number; pctLabel: string; tone: string; drill: Omit<DrillFilters, "from" | "to" | "direction" | "leads_source"> };
  const totalsCards: TotalCard[] = [
    { label: "Total calls", value: k.totalCalls, pctLabel: "100%", tone: "var(--info)", drill: {} },
    { label: "Answered", value: k.answered, pctLabel: pct(k.answered, 0), tone: "var(--good)", drill: { answered: "yes" } },
    { label: "Unanswered", value: k.notAnswered, pctLabel: pct(k.notAnswered, 0), tone: "var(--bad)", drill: { answered: "no" } },
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
              {tile.pctLabel && (
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {tile.pctLabel} of calls
                </div>
              )}
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
              ariaLabel={`${tile.label} — view calls`}
              onClick={() => openDrill(tile.label, tile.icon, tile.tone ?? "var(--accent)", tile.drill!)}
              style={{ padding: 16, borderColor: tile.highlight ? "var(--good)" : undefined }}
            >
              {inner}
            </ClickCard>
          );
        })}
      </div>

      {/* THRESHOLD CHIP ROW — controls the "Duration > X" KPI tile above. */}
      <div
        className="card"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 12 }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Qualifying call threshold
          <span className="muted" style={{ fontWeight: 400 }}> · minimum duration :</span>
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
          ⧖ {k.callsOverThreshold} call(s) {">"} {threshold < 60 ? `${threshold}s` : `${threshold / 60} min`}
        </span>
        <div className="muted" style={{ fontSize: 11, flex: 1, minWidth: 200 }}>
          Filters the &apos;DURATION &gt; X&apos; tile above. Other KPIs are unaffected.
        </div>
      </div>

      {/* TOTALS STRIP */}
      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {totalsCards.map((c) => (
          <ClickCard
            key={c.label}
            ariaLabel={`${c.label} — view calls`}
            onClick={() => openDrill(c.label, "phone", c.tone, c.drill)}
            style={{ padding: 16 }}
          >
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: c.tone }}>{c.value.toLocaleString()}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{c.pctLabel} of calls</div>
          </ClickCard>
        ))}
      </div>

      {/* QUALIFICATIONS GRID — 9 fixed cards */}
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>Qualifications</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Source : <code>calls.metadata.qualification</code> + <code>calls.disposition</code>
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {data.qualifications.map((q) => (
            <ClickCard
              key={q.key}
              ariaLabel={`${q.label} — view calls`}
              onClick={() => openDrill(q.label, "tag", "var(--accent)", { qualification: q.key as QualBucket })}
              style={{ padding: 12, textAlign: "center", borderColor: q.count > 0 ? "var(--accent)" : undefined }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: q.count > 0 ? "var(--accent)" : "var(--muted)" }}>
                {q.count}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {pct(q.count)}
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
              onClick={() => openDrill("Answered calls not yet qualified", "alert", "var(--warn)", { qualification: "unqualified" })}
              aria-label="View unqualified calls"
              style={{
                fontSize: 22, fontWeight: 700, color: "var(--warn)",
                background: "transparent", border: "none", padding: 0, cursor: "pointer",
              }}
            >
              {data.unqualified}
            </button>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                Answered calls not yet qualified
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Automatic AI qualification: every answered call is classified by the AI from its transcript. The backlog clears itself.
              </div>
            </div>
            <span className="muted" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {qualifying && <Sparkles size={14} className="ai-spin" aria-hidden />}
              {qualifying
                ? (qualifyMsg ?? "AI qualification in progress…")
                : (qualifyMsg ?? <><Sparkles size={14} style={{ verticalAlign: "middle" }} /> Automatic AI qualification</>)}
            </span>
          </div>
        )}
        <style jsx>{`@keyframes ai-spin-kf{0%,100%{opacity:.45}50%{opacity:1}} .ai-spin{animation:ai-spin-kf 1s ease-in-out infinite}`}</style>
      </div>

      {/* INBOUND CALLS — each figure drills into the matching call list. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Inbound calls</h3>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => openDrill("Inbound calls", "inbound", "var(--info)", { inbound_only: true })}
            aria-label="View all inbound calls"
            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--info)" }}>{data.inbound.total}</div>
            <div className="muted" style={{ fontSize: 11 }}>Total</div>
          </button>
          <div className="muted" style={{ fontSize: 13, display: "inline-flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => openDrill("Inbound answered", "check", "var(--good)", { inbound_only: true, answered: "yes" })}
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--good)" }}
            >
              {data.inbound.answered} answered
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => openDrill("Inbound no answer", "✕", "var(--bad)", { inbound_only: true, answered: "no" })}
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--bad)" }}
            >
              {data.inbound.notAnswered} no answer
            </button>
          </div>
        </div>
      </div>

      {/* J1 / J3 / J5 FOLLOW-UP + SLOTS */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 2 }}>J1 / J3 / J5 Follow-up</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 0 }}>
              Scheduled follow-ups by phase and call distribution by slot
            </p>
          </div>
          {data.hints.phasesAvailable && (
            <div style={{ textAlign: "right", fontSize: 11 }} className="muted">
              <div>
                Pipeline as of <strong style={{ color: "var(--text)" }}>{fmtDay(data.phaseContext.asOf)}</strong>
              </div>
              <div>{data.phaseContext.totalLeads.toLocaleString()} leads total</div>
            </div>
          )}
        </div>

        {data.hints.phasesAvailable ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 12 }}>
              {([
                ["CALLBACK", data.phases.rappel, "Leads marked 'to call back'"],
                ["J1", data.phases.j1, "Follow-up scheduled at J+1"],
                ["J3", data.phases.j3, "Follow-up scheduled at J+3"],
                ["J5", data.phases.j5, "Follow-up scheduled at J+5"],
              ] as const).map(([label, p, desc]) => (
                <div key={label} className="card" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 11, letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 1, lineHeight: 1.3 }}>{desc}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{p.leads.toLocaleString()} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>leads</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{p.calls.toLocaleString()} calls</div>
                  {/* Date breakdown: where each lead's scheduled call sits vs today. */}
                  <div style={{ display: "flex", gap: 4, marginTop: 8, fontSize: 10, flexWrap: "wrap" }}>
                    <span title="To call today" style={{ padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", fontWeight: 600 }}>
                      {p.dueToday} today
                    </span>
                    <span title="Follow-up date overdue" style={{ padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", fontWeight: 600 }}>
                      {p.overdue} overdue
                    </span>
                    <span title="Upcoming follow-up" className="muted" style={{ padding: "2px 6px", borderRadius: 4, background: "var(--bg-2)" }}>
                      {p.upcoming} upcoming
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0, fontStyle: "italic" }}>
              Phase volumes cover the entire pipeline (independent of the selected period).
            </p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            No phase table configured for this organisation.
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>By call slot</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Period : {fmtDay(data.phaseContext.period.from)} – {fmtDay(data.phaseContext.period.to)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {([
              ["Slot 1 — morning", SLOT_WINDOWS.matin, data.slots.matin, "matin", "matin", <Sunrise size={13} />],
              ["Slot 2 — midday", SLOT_WINDOWS.midi, data.slots.midi, "midi", "midi", <Sun size={13} />],
              ["Slot 3 — evening", SLOT_WINDOWS.soir, data.slots.soir, "soir", "soir", <Sunset size={13} />],
              ["Off-slot", null, data.slots.hors, "hors", "hors", <Moon size={13} />],
            ] as const).map(([label, win, v, slot, iconStr, displayIcon]) => {
              const slotTotal = data.slots.matin + data.slots.midi + data.slots.soir + data.slots.hors;
              const slotPct = slotTotal ? Math.round((v / slotTotal) * 100) : 0;
              return (
                <ClickCard
                  key={label}
                  ariaLabel={`${label} — view calls`}
                  onClick={() => openDrill(label, iconStr, "var(--accent)", { slot })}
                  style={{ padding: 10 }}
                >
                  <div className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>{displayIcon} {label}</div>
                  <div className="muted" style={{ fontSize: 10 }}>
                    {win ? `${win.uk} UK · ${win.mu} MU` : "other hours"}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                    {v.toLocaleString()} <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>· {slotPct}%</span>
                  </div>
                </ClickCard>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0, fontStyle: "italic" }}>
            Call windows Mon–Thu. Friday: morning slot extended to 08h–11h UK, no midday/evening. Weekend: off-slot.
          </p>
        </div>
      </div>

      {/* AGENT CHAIN */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Agent chain</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          How many leads went through 1, 2, or 3 agents
          {qualifying && (
            <span style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Sparkles size={14} className="ai-spin" aria-hidden /> {qualifyMsg ?? "Automatic AI analysis…"}
            </span>
          )}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {([
            ["Agent 1 only", data.agentChain.only1, 1],
            ["Agent 1 → Agent 2", data.agentChain.plus2, 2],
            ["Agent 1 → 2 → 3", data.agentChain.plus3, 3],
          ] as const).map(([label, v, stage]) => (
            <button
              key={label}
              type="button"
              className="card"
              onClick={() => openDrill(label, "link", "var(--accent)", { agent_stage: stage as 1 | 2 | 3 })}
              aria-label={`View calls — ${label}`}
              style={{ padding: 12, textAlign: "left", cursor: "pointer", color: "inherit" }}
            >
              <div className="muted" style={{ fontSize: 11 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{v}</div>
            </button>
          ))}
        </div>
      </div>

      {/* DURATION DISTRIBUTION + WHAT THEY SAID */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Duration distribution</h3>
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
                onClick={() => openDrill(`Duration ${label}`, "timer", "var(--accent)", { duration_bucket: bucket })}
                aria-label={`Duration ${label} — view calls`}
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
          <h3 style={{ marginTop: 0 }}>What they said</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Call summaries grouped by qualification
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              className={activeQualTab === "all" ? "" : "ghost"}
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => setActiveQualTab("all")}
            >
              All ({data.summaries.length})
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
                ? "No summaries for this qualification."
                : "No call summaries for this period. Summaries are generated post-call."}
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

      {/* CASES TO HAND OFF TO A HUMAN */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cases to hand off to a human</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Leads awaiting human callback · <code>human_callback_tasks</code>
        </p>
        {data.humanCallbacks.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No pending cases.</p>
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
                    {h.qualification ?? "Pass to human agent"}
                    {h.scheduled_for && ` · ${fmtDate(h.scheduled_for)}`}
                    {h.status && ` · ${h.status}`}
                  </div>
                </div>
                <a
                  href={`/desk?task=${h.task_id}`}
                  className="ghost"
                  style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none" }}
                >
                  View in My desk →
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
