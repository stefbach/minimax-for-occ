"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { DirectorResponse } from "@/app/api/dashboard/director/route";
import type { QualBucket } from "@/lib/qualification";
import { useT } from "@/lib/i18n";
import { DrillSheet, type DrillFilters, type DrillSpec } from "./DrillSheet";

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

export function DirectorTab({ from, to, direction, leadsSource = "prod", system = "all" }: { from: string; to: string; direction: string; leadsSource?: "prod" | "test"; system?: "all" | "retell" | "axon" }) {
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
      ...extra,
    };
    setDrill({ title, subtitle, icon, tone, filters });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from, to, threshold: String(threshold), leads_source: leadsSource });
    if (direction !== "all") qs.set("direction", direction);
    if (system !== "all") qs.set("system", system);
    fetch(`/api/dashboard/director?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) { setData(j); setError(null); }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to, direction, threshold, leadsSource, system, reloadKey]);

  // Ask the AI to classify the answered-but-unqualified calls so they stop
  // hiding in the "autre" bucket. Scoped to the current leads source so a
  // Prod-only backlog isn't re-counted while the operator is browsing Test.
  // Bounded server-side; may need a second run for large backlogs.
  const runQualify = async () => {
    setQualifying(true);
    setQualifyMsg(null);
    try {
      const qs = new URLSearchParams({ leads_source: leadsSource });
      if (system !== "all") qs.set("system", system);
      const r = await fetch(`/api/dashboard/qualify-unqualified?${qs}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const remaining = Number(j.remaining ?? 0);
      setQualifyMsg(
        `${j.qualified}/${j.processed} ${t("appel(s) qualifié(s) par l'IA")}` +
          (remaining > 0 ? ` · ${remaining} ${t("restant(s)")}` : ""),
      );
      setReloadKey((k) => k + 1);
    } catch (e) {
      setQualifyMsg(e instanceof Error ? e.message : "error");
    } finally {
      setQualifying(false);
    }
  };

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
    tone?: string;
    highlight?: boolean;
    // null means the card isn't drillable (e.g. derived ratios) — disable the click.
    drill: Omit<DrillFilters, "from" | "to" | "direction" | "leads_source"> | null;
  };
  const tiles: Tile[] = [
    { label: t("Total appels"), value: k.totalCalls.toLocaleString(), icon: "📞", tone: "var(--info)", drill: {} },
    { label: t("Décrochés"), value: `${k.answered.toLocaleString()} · ${k.answeredPct.toFixed(0)}%`, icon: "✅", tone: "var(--good)", drill: { answered: "yes" } },
    // Cost is an aggregate over usage_events, not a call subset → no drill.
    { label: t("Coût consommé"), value: `$${k.cost.toFixed(2)}`, icon: "$", tone: "var(--warn)", drill: null },
    { label: t("RDV confirmés"), value: k.rdvConfirmed.toLocaleString(), icon: "📅", tone: "var(--good)", highlight: true, drill: { qualification: "rdv_confirme" } },
    // Conversion = RDV / Total → drill to the RDV calls (the numerator).
    { label: t("Taux de conversion"), value: `${k.conversionRate.toFixed(1)}%`, icon: "📈", tone: "var(--accent-2)", drill: { qualification: "rdv_confirme" } },
    { label: t("Durée moyenne"), value: fmtDur(k.avgDuration), icon: "⏱", tone: "var(--info)", drill: { answered: "yes" } },
    { label: t("Callbacks demandés"), value: k.callbacks.toLocaleString(), icon: "↺", tone: "var(--accent)", drill: { qualification: "rappel" } },
    { label: `${t("Durée")} > ${k.threshold}s`, value: k.callsOverThreshold.toLocaleString(), icon: "⧖", tone: "var(--muted)", drill: { min_duration: k.threshold } },
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
                <span style={{ fontSize: 16 }}>{tile.icon}</span>
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
            onClick={() => openDrill(c.label, "📞", c.tone, c.drill)}
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
              onClick={() => openDrill(q.label, "🏷", "var(--accent)", { qualification: q.key as QualBucket })}
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
              onClick={() => openDrill(t("Appels décrochés non qualifiés"), "⚠", "var(--warn)", { qualification: "unqualified" })}
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
                {t("Un appel décroché doit toujours être classé. L'IA lit le transcript et l'affecte à la bonne carte.")}
              </div>
            </div>
            {qualifyMsg && (
              <span className="muted" style={{ fontSize: 11 }}>{qualifyMsg}</span>
            )}
            <button onClick={runQualify} disabled={qualifying}>
              {qualifying ? t("Qualification…") : `✨ ${t("Qualifier avec l'IA")}`}
            </button>
          </div>
        )}
      </div>

      {/* APPELS ENTRANTS — each figure drills into the matching call list. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Appels entrants")}</h3>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => openDrill(t("Appels entrants"), "↘", "var(--info)", { inbound_only: true })}
            aria-label={t("Voir tous les entrants")}
            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--info)" }}>{data.inbound.total}</div>
            <div className="muted" style={{ fontSize: 11 }}>{t("Total")}</div>
          </button>
          <div className="muted" style={{ fontSize: 13, display: "inline-flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => openDrill(t("Entrants décrochés"), "✅", "var(--good)", { inbound_only: true, answered: "yes" })}
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
        <h3 style={{ marginTop: 0 }}>{t("Suivi J1 / J3 / J5")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Volume par phase et par créneau d'appel")}
        </p>
        {data.hints.phasesAvailable ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {([
              ["RAPPEL", data.phases.rappel],
              ["J1", data.phases.j1],
              ["J3", data.phases.j3],
              ["J5", data.phases.j5],
            ] as const).map(([label, p]) => (
              <div key={label} className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 11, letterSpacing: 0.4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{p.leads} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>leads</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{p.calls} {t("appels")}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            {t("Aucune table de phases configurée pour cette organisation.")}
          </p>
        )}
        <div style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t("Par créneau")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {([
              ["Créneau 1 — matin", data.slots.matin, "matin", "🌅"],
              ["Créneau 2 — midi", data.slots.midi, "midi", "☀"],
              ["Créneau 3 — soir", data.slots.soir, "soir", "🌆"],
              ["Hors créneau", data.slots.hors, "hors", "🌙"],
            ] as const).map(([label, v, slot, icon]) => (
              <ClickCard
                key={label}
                ariaLabel={`${label} — ${t("voir les appels")}`}
                onClick={() => openDrill(label, icon, "var(--accent)", { slot })}
                style={{ padding: 10 }}
              >
                <div className="muted" style={{ fontSize: 11 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{v}</div>
              </ClickCard>
            ))}
          </div>
        </div>
      </div>

      {/* CHAÎNE D'AGENTS */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Chaîne d'agents")}</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {t("Combien de leads sont passés sur 1, 2 ou 3 agents")}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {([
            ["Agent 1 uniquement", data.agentChain.only1],
            ["Agent 1 → Agent 2", data.agentChain.plus2],
            ["Agent 1 → 2 → 3", data.agentChain.plus3],
          ] as const).map(([label, v]) => (
            <div key={label} className="card" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 11 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{v}</div>
            </div>
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
                onClick={() => openDrill(`${t("Durée")} ${label}`, "⏱", "var(--accent)", { duration_bucket: bucket })}
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
      <DrillSheet spec={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
