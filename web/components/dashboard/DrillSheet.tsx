"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import type { DrillCall, DrillResponse } from "@/app/api/dashboard/calls-drill/route";
import { CallDetailPane } from "@/components/dashboard/CallDetailPane";

// Generic drill-down side panel — every clickable card on the dashboard opens
// THIS component. Designed to match the existing card aesthetic (CSS vars, no
// modal full-screen), accessible (ESC + focus return + aria-modal), responsive
// (full-width drawer on mobile), and offers actions the legacy dashboard
// didn't: CSV export, deep-link to filtered Call Logs, per-row navigation.

export type DrillFilters = {
  from: string;
  to: string;
  direction?: string; // all | in | out
  qualification?: QualBucket | "unqualified";
  answered?: "yes" | "no";
  duration_bucket?: "lt15s" | "s15_60" | "m1_2" | "m2_3" | "m3_5" | "gt5m";
  slot?: "matin" | "midi" | "soir" | "hors";
  min_duration?: number;
  inbound_only?: boolean;
  leads_source?: "prod" | "test";
  system?: "retell" | "axon";
  // Agent-chain stage: 1 = first agent only, 2 = reached a 2nd agent, 3 = reached a 3rd.
  agent_stage?: 1 | 2 | 3;
};

export type DrillSpec = {
  title: string;
  subtitle?: string;
  icon?: string;
  tone?: string; // CSS var for the accent stripe
  filters: DrillFilters;
};

const QUAL_TONE: Record<QualBucket, string> = {
  rdv_confirme: "var(--good)",
  passer_humain: "var(--good)",
  rappel: "var(--accent)",
  pas_interesse: "var(--bad)",
  pas_de_reponse: "var(--warn)",
  repondeur: "var(--warn)",
  faux_numero: "var(--bad)",
  non_eligible: "var(--bad)",
  ne_pas_rappeler: "var(--bad)",
  autre: "var(--muted)",
};

function fmtDur(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function qualLabel(q: QualBucket): string {
  return QUAL_BUCKETS.find((b) => b.key === q)?.label ?? q;
}

// Decroché / non-decroché indicator — a small themed phone glyph. Green ring +
// handset for answered, muted ring + slash for unanswered. aria-labelled for SR.
function AnsweredIcon({ answered, t }: { answered: boolean; t: (s: string) => string }) {
  const color = answered ? "var(--good)" : "var(--muted)";
  const label = answered ? t("Décroché") : t("Non décroché");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: 99,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        {!answered && <line x1="3" y1="3" x2="21" y2="21" />}
      </svg>
    </span>
  );
}

function buildQS(filters: DrillFilters): string {
  const qs = new URLSearchParams();
  qs.set("from", filters.from);
  qs.set("to", filters.to);
  if (filters.direction && filters.direction !== "all") qs.set("direction", filters.direction);
  if (filters.qualification) qs.set("qualification", filters.qualification);
  if (filters.answered) qs.set("answered", filters.answered);
  if (filters.duration_bucket) qs.set("duration_bucket", filters.duration_bucket);
  if (filters.slot) qs.set("slot", filters.slot);
  if (filters.min_duration) qs.set("min_duration", String(filters.min_duration));
  if (filters.inbound_only) qs.set("inbound_only", "1");
  if (filters.leads_source) qs.set("leads_source", filters.leads_source);
  if (filters.system) qs.set("system", filters.system);
  if (filters.agent_stage) qs.set("agent_stage", String(filters.agent_stage));
  return qs.toString();
}

function toCSV(rows: DrillCall[]): string {
  const header = ["started_at", "direction", "contact", "phone", "agent", "duration_secs", "answered", "qualification", "disposition"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.started_at, r.direction, r.contact_name, r.phone, r.agent_name, r.duration_secs, r.answered, r.qualification, r.disposition]
      .map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function DrillSheet({ spec, onClose }: { spec: DrillSpec | null; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Which row is expanded into the in-panel detail view (null = list view).
  // Kept here so the list underneath stays mounted and scrolled — going "back"
  // just drops this overlay and you're exactly where you left off.
  const [selected, setSelected] = useState<DrillCall | null>(null);
  const open = Boolean(spec);
  const lastFocused = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Restore focus to whatever opened us — basic keyboard hygiene.
  useEffect(() => {
    if (open) {
      lastFocused.current = (document.activeElement as HTMLElement) ?? null;
      // Defer to next tick so the close button is mounted.
      setTimeout(() => closeBtnRef.current?.focus(), 0);
    } else if (lastFocused.current) {
      lastFocused.current.focus();
    }
  }, [open]);

  // ESC closes the detail overlay first (if open), otherwise the whole sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, selected]);

  // Lock body scroll while open — without this, scrolling inside the sheet
  // bleeds through to the page on iOS / trackpads.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!spec) return;
    let alive = true;
    setSelected(null); // new drill → back to list view
    setLoading(true); setErr(null); setData(null);
    fetch(`/api/dashboard/calls-drill?${buildQS(spec.filters)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) setData(j as DrillResponse);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [spec]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const blob = new Blob([toCSV(data.calls)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-drill-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const callLogsHref = useMemo(() => {
    if (!spec) return "/dashboard?tab=logs";
    // Forward the period + direction; bucket-specific filters are visible in
    // the panel but the Call Logs tab will apply its own client filters.
    const qs = new URLSearchParams({ tab: "logs" });
    return `/dashboard?${qs.toString()}`;
  }, [spec]);

  if (!open || !spec) return null;
  const tone = spec.tone ?? "var(--accent)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={spec.title}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", justifyContent: "flex-end",
      }}
    >
      {/* Backdrop — click to close, semi-opaque so the dashboard stays visible. */}
      <button
        type="button"
        aria-label={t("Fermer")}
        onClick={onClose}
        style={{
          position: "absolute", inset: 0, border: 0, padding: 0, cursor: "pointer",
          background: "color-mix(in srgb, black 45%, transparent)",
          backdropFilter: "blur(2px)",
          animation: "drill-fade 180ms ease-out",
        }}
      />
      {/* Panel — slides in from the right; full-width on small screens. */}
      <aside
        style={{
          position: "relative",
          width: "min(520px, 100vw)",
          height: "100%",
          background: "var(--bg)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column",
          animation: "drill-slide 220ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Accent stripe — picks up the tone of the clicked card. */}
        <div style={{ height: 3, background: tone }} />

        {/* Sticky header */}
        <div
          style={{
            padding: "14px 16px",
            display: "flex", alignItems: "center", gap: 12,
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
          }}
        >
          {spec.icon && <span style={{ fontSize: 22 }}>{spec.icon}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {spec.title}
            </div>
            {spec.subtitle && (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{spec.subtitle}</div>
            )}
          </div>
          {data && (
            <span
              style={{
                padding: "3px 9px", fontSize: 12, fontWeight: 600, borderRadius: 99,
                background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                color: "var(--accent)",
              }}
            >
              {data.total}
            </span>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="ghost"
            aria-label={t("Fermer")}
            style={{ padding: "4px 10px", fontSize: 16, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading && (
            <div style={{ padding: 12, display: "grid", gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    height: 52, borderRadius: 8,
                    background: "color-mix(in srgb, var(--muted) 14%, transparent)",
                    animation: "drill-pulse 1.2s ease-in-out infinite",
                  }}
                />
              ))}
            </div>
          )}
          {err && (
            <div className="card" style={{ margin: 12, borderColor: "var(--bad)", color: "var(--bad)" }}>
              {err}
            </div>
          )}
          {data && data.calls.length === 0 && !loading && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>∅</div>
              <div style={{ fontSize: 13 }}>{t("Aucun appel ne correspond à cette sélection sur la période.")}</div>
            </div>
          )}
          {data && data.calls.map((c) => {
            const hasName = Boolean(c.contact_name);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "10px 16px", textAlign: "left",
                  background: "transparent", border: 0,
                  color: "inherit", cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 6%, transparent)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span
                  aria-hidden
                  style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: QUAL_TONE[c.qualification] }}
                />
                <AnsweredIcon answered={c.answered} t={t} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.contact_name ?? c.phone ?? t("Inconnu")}
                    </span>
                    <span aria-hidden style={{ fontSize: 10, color: "var(--muted)" }}>
                      {c.direction === "in" ? "↘" : "↗"}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {/* Show the number too when we resolved a real name. */}
                    {hasName && c.phone && (<><span>{c.phone}</span><span>·</span></>)}
                    <span>{fmtDate(c.started_at)}</span>
                    <span>·</span>
                    <span>{fmtDur(c.duration_secs)}</span>
                    {c.agent_name && (<><span>·</span><span>{c.agent_name}</span></>)}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10, padding: "3px 7px", borderRadius: 4, whiteSpace: "nowrap",
                    background: `color-mix(in srgb, ${QUAL_TONE[c.qualification]} 14%, transparent)`,
                    color: QUAL_TONE[c.qualification],
                    fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3,
                  }}
                >
                  {qualLabel(c.qualification)}
                </span>
              </button>
            );
          })}
          {data?.truncated && (
            <div className="muted" style={{ padding: 12, fontSize: 11, textAlign: "center" }}>
              {t("Aperçu limité aux 100 plus récents.")}
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="ghost"
            onClick={exportCsv}
            disabled={!data || data.calls.length === 0}
            style={{ padding: "5px 12px", fontSize: 12 }}
          >
            ↓ {t("Exporter CSV")}
          </button>
          <div style={{ flex: 1 }} />
          <Link href={callLogsHref} className="ghost" style={{ padding: "5px 12px", fontSize: 12, textDecoration: "none" }}>
            {t("Voir dans Call Logs")} →
          </Link>
        </div>

        {/* In-panel call detail — overlays the list (which stays mounted and
            scrolled underneath), so "← Retour" lands you exactly where you were. */}
        {selected && (
          <CallDetailPane
            call={selected}
            leadsSource={spec.filters.leads_source ?? "prod"}
            onBack={() => setSelected(null)}
          />
        )}
      </aside>

      <style jsx>{`
        @keyframes drill-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes drill-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes drill-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
      `}</style>
    </div>
  );
}
