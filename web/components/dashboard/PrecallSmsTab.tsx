"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { normalizeQualification } from "@/lib/qualification";
import { GLOBAL_DURATION_BUCKETS, type GlobalFilters } from "@/lib/global-filters";
import type { DrillCall } from "@/app/api/dashboard/calls-drill/route";
import { CallDetailPane } from "@/components/dashboard/CallDetailPane";

// SMS tab — suivi des messages pré-appel (Wati 26/06). Une ligne par SMS /
// WhatsApp envoyé avant un appel : nom du lead, heure d'envoi, canal, statut
// d'envoi, l'appel qui a suivi (et son délai) et si le patient a décroché.
// Source : table precall_sms_log, jointe à l'appel suivant côté API.

interface SmsRow {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  target_id: string | null;
  to_e164: string | null;
  lead_name: string | null;
  channel: string;
  status: string; // 'sent' | 'failed'
  error: string | null;
  attempt: number | null;
  sent_at: string;
  call_id: string | null;
  call_at: string | null;
  delay_secs: number | null;
  duration_secs: number | null;
  answered: "answered" | "no_answer" | "voicemail" | "pending";
  qualification: string | null;
}

// Colour the post-call qualification by outcome family.
function qualTone(q: string | null): string {
  if (!q) return "var(--muted)";
  const u = q.toUpperCase();
  if (/RDV CONFIRME|A PASSER A L'HUMAIN|INTERESSE(?! PAS)|RAPPEL/.test(u) && !/PAS INTERESSE/.test(u)) return "var(--good)";
  if (/PAS INTERESSE|NE PAS RAPPELER|NON ELIGIBLE|FAUX NUMERO/.test(u)) return "var(--bad)";
  if (/REPONDEUR|PAS DE REPONSE|SUIVI REQUIS/.test(u)) return "var(--warn)";
  return "var(--muted)";
}

function passesGlobal(r: SmsRow, gf?: GlobalFilters): boolean {
  if (!gf) return true;
  if (gf.attempt !== "all") {
    const a = r.attempt ?? null;
    if (a == null) return false;
    if (gf.attempt === "1" && a !== 1) return false;
    if (gf.attempt === "2" && a !== 2) return false;
    if (gf.attempt === "3plus" && a < 3) return false;
  }
  if (gf.answered === "yes" && r.answered !== "answered") return false;
  if (gf.answered === "no" && r.answered === "answered") return false;
  if (gf.quals.length && !gf.quals.includes(normalizeQualification(r.qualification))) return false;
  if (gf.durations.length) {
    const d = r.duration_secs ?? 0;
    const ok = gf.durations.some((id) => {
      const b = GLOBAL_DURATION_BUCKETS.find((x) => x.id === id);
      return b ? d >= b.min && d < b.max : false;
    });
    if (!ok) return false;
  }
  if (gf.q) {
    const hay = `${r.lead_name ?? ""} ${r.to_e164 ?? ""}`.toLowerCase();
    if (!gf.q.toLowerCase().split(/\s+/).filter(Boolean).every((tk) => hay.includes(tk))) return false;
  }
  return true;
}

type StatusFilter = "all" | "called" | "answered" | "no_answer" | "voicemail" | "pending" | "failed";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "called", label: "Appelés" },
  { id: "answered", label: "Décrochés (humain)" },
  { id: "no_answer", label: "Sans réponse" },
  { id: "voicemail", label: "Répondeur" },
  { id: "pending", label: "Appel pas encore passé" },
  { id: "failed", label: "Échec d'envoi" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDelay(secs: number | null): string {
  if (secs == null || secs < 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

// Adapt a SmsRow (which already carries the call outcome) to the DrillCall
// shape that CallDetailPane expects. `id` must be the CALL id so the detail
// pane can fetch the recording / transcript.
function smsRowToCall(r: SmsRow): DrillCall {
  return {
    id: r.call_id!,
    started_at: r.call_at,
    direction: "out",
    duration_secs: r.duration_secs,
    answered: r.answered === "answered",
    qualification: normalizeQualification(r.qualification),
    contact_name: r.lead_name,
    agent_name: null,
    phone: r.to_e164,
    disposition: r.qualification,
    assignee: null,
  };
}

type SmsDrillSpec = {
  title: string;
  icon: string;
  tone: string;
  rows: SmsRow[];
};

export function PrecallSmsTab({ from, to, global }: { from: string; to: string; global?: GlobalFilters }) {
  const t = useT();
  const [rows, setRows] = useState<SmsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  // Side-panel drill state
  const [smsDrillSpec, setSmsDrillSpec] = useState<SmsDrillSpec | null>(null);
  const [smsDrillSelected, setSmsDrillSelected] = useState<SmsRow | null>(null);

  // ESC: close detail first, then whole panel
  useEffect(() => {
    if (!smsDrillSpec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (smsDrillSelected) setSmsDrillSelected(null);
      else setSmsDrillSpec(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [smsDrillSpec, smsDrillSelected]);

  // Body scroll lock while panel is open
  useEffect(() => {
    if (!smsDrillSpec) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [smsDrillSpec]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from, to });
      const r = await fetch(`/api/dashboard/precall-sms?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(Array.isArray(j) ? j : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const scoped = useMemo(() => rows.filter((r: SmsRow) => passesGlobal(r, global)), [rows, global]);

  const kpis = useMemo(() => {
    let sent = 0, failed = 0, called = 0, answered = 0, voicemail = 0;
    const answeredContacts = new Set<string>();
    for (const r of scoped) {
      if (r.status === "failed") failed += 1; else sent += 1;
      if (r.call_id) called += 1;
      if (r.answered === "answered") {
        answered += 1;
        if (r.contact_id) answeredContacts.add(r.contact_id);
      }
      if (r.answered === "voicemail") voicemail += 1;
    }
    return { sent, failed, called, answered, answeredLeads: answeredContacts.size, voicemail, total: scoped.length };
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((r: SmsRow) => {
      if (statusFilter === "failed" && r.status !== "failed") return false;
      if (statusFilter === "called" && (!r.call_id || r.status === "failed")) return false;
      if (statusFilter === "answered" && r.answered !== "answered") return false;
      if (statusFilter === "no_answer" && r.answered !== "no_answer") return false;
      if (statusFilter === "voicemail" && r.answered !== "voicemail") return false;
      if (statusFilter === "pending" && r.answered !== "pending") return false;
      if (!q) return true;
      const hay = `${r.lead_name ?? ""} ${r.to_e164 ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [scoped, search, statusFilter]);

  function answeredBadge(r: SmsRow) {
    if (r.status === "failed") return <span className="muted" style={{ whiteSpace: "nowrap" }}>—</span>;
    switch (r.answered) {
      case "answered":
        return <span style={{ color: "var(--good)", whiteSpace: "nowrap" }}>✅ {t("Décroché")}</span>;
      case "no_answer":
        return <span style={{ color: "var(--warn)", whiteSpace: "nowrap" }}>❌ {t("Pas de réponse")}</span>;
      case "voicemail":
        return <span style={{ color: "var(--warn)", whiteSpace: "nowrap" }}>📵 {t("Répondeur")}</span>;
      default:
        return <span className="muted" style={{ whiteSpace: "nowrap" }}>⏳ {t("Appel pas encore passé")}</span>;
    }
  }

  // Open the side-panel drill with a subset of `scoped` rows.
  function openSmsDrill(title: string, icon: string, tone: string, filterFn: (r: SmsRow) => boolean) {
    setSmsDrillSpec({ title, icon, tone, rows: scoped.filter(filterFn) });
    setSmsDrillSelected(null);
  }

  const kpiCardStyle = {
    padding: 14, textAlign: "left" as const, font: "inherit", color: "inherit",
    cursor: "pointer", transition: "transform 120ms, box-shadow 120ms",
  };
  function hoverIn(e: { currentTarget: HTMLButtonElement }) {
    e.currentTarget.style.transform = "translateY(-1px)";
    e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.08)";
  }
  function hoverOut(e: { currentTarget: HTMLButtonElement }) {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.boxShadow = "";
  }

  return (
    <>
      {/* KPI cards — cliquables pour ouvrir le panneau latéral */}
      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <button type="button" className="card" style={kpiCardStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          onClick={() => openSmsDrill(t("SMS envoyés"), "💬", "var(--accent)", (r: SmsRow) => r.status !== "failed")}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("SMS envoyés")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{kpis.sent}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("sur la période")}</div>
        </button>

        <button type="button" className="card" style={kpiCardStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          onClick={() => openSmsDrill(t("Appels passés après SMS"), "📞", "var(--info)", (r) => !!r.call_id && r.status !== "failed")}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Appels passés après SMS")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--info)" }}>{kpis.called}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.sent ? Math.round((kpis.called / kpis.sent) * 100) : 0}% {t("des envois")}
          </div>
        </button>

        <button type="button" className="card" style={kpiCardStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          onClick={() => {
            const seen = new Set<string>();
            const uniqueRows = scoped.filter((r: SmsRow) => {
              if (r.answered !== "answered") return false;
              const key = r.contact_id ?? r.to_e164 ?? r.id;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setSmsDrillSpec({ title: t("Décrochés — leads uniques"), icon: "✅", tone: "var(--good)", rows: uniqueRows });
            setSmsDrillSelected(null);
          }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Décroché — leads uniques")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--good)" }}>✅ {kpis.answeredLeads}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("leads distincts ayant décroché")}</div>
        </button>

        <button type="button" className="card" style={kpiCardStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          onClick={() => openSmsDrill(t("Décrochés — par appels"), "✅", "var(--good)", (r) => r.answered === "answered")}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Décroché — par appels")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--good)" }}>✅ {kpis.answered}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.called ? Math.round((kpis.answered / kpis.called) * 100) : 0}% {t("des appels")}
            {kpis.voicemail > 0 ? ` · 📵 ${kpis.voicemail} ${t("répondeur")}` : ""}
          </div>
        </button>

        <button type="button" className="card"
          style={{ ...kpiCardStyle, borderColor: kpis.failed > 0 ? "var(--bad)" : undefined }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
          onClick={() => openSmsDrill(t("Échecs d'envoi"), "✗", "var(--bad)", (r) => r.status === "failed")}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Échecs d'envoi")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: kpis.failed > 0 ? "var(--bad)" : undefined }}>{kpis.failed}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("SMS non partis")}</div>
        </button>
      </div>

      {/* Filters */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Filtrer")} :</span>
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} type="button" className={statusFilter === f.id ? "" : "ghost"}
              style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setStatusFilter(f.id)}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label>{t("Rechercher")}</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Nom ou numéro…")} />
        </div>
        <button type="button" className="ghost" style={{ padding: "6px 12px" }} onClick={fetchData}>↻ {t("Actualiser")}</button>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t("Heure SMS")}</th>
              <th>{t("Lead")}</th>
              <th>{t("Numéro")}</th>
              <th>{t("Canal")}</th>
              <th style={{ textAlign: "center" }}>{t("Envoi")}</th>
              <th>{t("Appel après")}</th>
              <th>{t("A décroché ?")}</th>
              <th>{t("Qualification")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="muted" style={{ padding: 16, textAlign: "center" }}>{t("Chargement…")}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="muted" style={{ padding: 24, textAlign: "center" }}>
                {rows.length === 0
                  ? t("Aucun SMS pré-appel envoyé sur cette période. Ils apparaîtront ici dès que la campagne tourne.")
                  : t("Aucun SMS ne correspond aux filtres.")}
              </td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>
                    {fmtDate(r.sent_at)}
                  </td>
                  <td>{r.lead_name || t("Inconnu")}{r.attempt ? <span className="muted" style={{ fontSize: 11 }}> · {t("tentative")} {r.attempt}</span> : null}</td>
                  <td className="muted" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{r.to_e164 ?? "—"}</td>
                  <td>
                    <span className="tag" style={{ fontSize: 10, whiteSpace: "nowrap" }}>
                      {r.channel === "whatsapp" ? "🟢 WhatsApp" : "💬 SMS"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {r.status === "failed"
                      ? <span style={{ color: "var(--bad)" }} title={r.error ?? ""}>✗ {t("échec")}</span>
                      : <span style={{ color: "var(--good)" }}>✓</span>}
                  </td>
                  <td>
                    {r.call_at ? (
                      <span style={{ whiteSpace: "nowrap" }}>
                        {fmtTime(r.call_at)}
                        <span className="muted" style={{ fontSize: 11 }}> · +{fmtDelay(r.delay_secs)}</span>
                      </span>
                    ) : (
                      <span className="muted" style={{ whiteSpace: "nowrap" }}>{t("pas encore")}</span>
                    )}
                  </td>
                  <td>
                    {r.call_id ? (
                      <Link href={`/calls/${r.call_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {answeredBadge(r)}
                      </Link>
                    ) : (
                      answeredBadge(r)
                    )}
                  </td>
                  <td>
                    {r.qualification ? (
                      <span className="tag" style={{ color: qualTone(r.qualification), borderColor: qualTone(r.qualification), fontSize: 10, whiteSpace: "nowrap" }}>
                        {r.qualification}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {filtered.length} / {scoped.length} {t("messages")}
        {scoped.length !== rows.length ? ` (${rows.length} ${t("au total, avant filtres")})` : ""}
      </div>

      {/* SMS drill-down side panel */}
      {smsDrillSpec && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={smsDrillSpec.title}
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label={t("Fermer")}
            onClick={() => setSmsDrillSpec(null)}
            style={{
              position: "absolute", inset: 0, border: 0, padding: 0, cursor: "pointer",
              background: "color-mix(in srgb, black 45%, transparent)",
              backdropFilter: "blur(2px)",
              animation: "sms-drill-fade 180ms ease-out",
            }}
          />
          {/* Panel */}
          <aside style={{
            position: "relative",
            width: "min(520px, 100vw)",
            height: "100%",
            background: "var(--bg)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
            display: "flex", flexDirection: "column",
            animation: "sms-drill-slide 220ms cubic-bezier(.2,.8,.2,1)",
          }}>
            {/* Accent stripe */}
            <div style={{ height: 3, background: smsDrillSpec.tone }} />

            {/* Header */}
            <div style={{
              padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
              borderBottom: "1px solid var(--border)", background: "var(--bg)",
            }}>
              <span style={{ fontSize: 22 }}>{smsDrillSpec.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {smsDrillSpec.title}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {smsDrillSpec.rows.length.toLocaleString("fr-FR")} {t("message(s) concerné(s)")}
                </div>
              </div>
              <span style={{
                padding: "3px 9px", fontSize: 12, fontWeight: 600, borderRadius: 99,
                background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                color: "var(--accent)",
              }}>
                {smsDrillSpec.rows.length}
              </span>
              <button
                type="button"
                autoFocus
                onClick={() => setSmsDrillSpec(null)}
                className="ghost"
                aria-label={t("Fermer")}
                style={{ padding: "4px 10px", fontSize: 16, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Body — list of SMS rows */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {smsDrillSpec.rows.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>∅</div>
                  <div style={{ fontSize: 13 }}>{t("Aucun message ne correspond à cette sélection.")}</div>
                </div>
              ) : smsDrillSpec.rows.map((r) => {
                const tone = r.status === "failed" ? "var(--bad)"
                  : r.answered === "answered" ? "var(--good)"
                  : r.answered === "voicemail" ? "var(--warn)"
                  : r.call_id ? "var(--info)"
                  : "var(--muted)";
                return (
                  <div
                    key={r.id}
                    className="card"
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      margin: "8px 12px", padding: "12px 14px", borderRadius: 10,
                      borderLeft: `3px solid ${tone}`,
                    }}
                  >
                    <button
                      type="button"
                      disabled={!r.call_id}
                      onClick={() => r.call_id && setSmsDrillSelected(r)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0,
                        background: "transparent", border: 0, color: "inherit",
                        cursor: r.call_id ? "pointer" : "default",
                        textAlign: "left", padding: 0, font: "inherit",
                      }}
                    >
                      {/* Status icon */}
                      <span style={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: 99,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: `color-mix(in srgb, ${tone} 16%, transparent)`,
                        color: tone, fontSize: 13,
                      }}>
                        {r.status === "failed" ? "✗"
                          : r.answered === "answered" ? "✅"
                          : r.answered === "voicemail" ? "📵"
                          : r.call_id ? "📞"
                          : "⏳"}
                      </span>
                      {/* Main info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.lead_name ?? t("Inconnu")}
                          {r.attempt ? <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · {t("tentative")} {r.attempt}</span> : null}
                        </div>
                        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                          {r.to_e164 ?? "—"}
                          {r.channel === "whatsapp" ? " · 🟢 WhatsApp" : " · 💬 SMS"}
                        </div>
                      </div>
                      {/* Right: qual badge + time */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                        {r.qualification ? (
                          <span style={{
                            fontSize: 11, padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap",
                            background: `color-mix(in srgb, ${qualTone(r.qualification)} 14%, transparent)`,
                            color: qualTone(r.qualification),
                            border: `1px solid color-mix(in srgb, ${qualTone(r.qualification)} 40%, transparent)`,
                            fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.4,
                          }}>
                            {r.qualification}
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 11, padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap",
                            background: "color-mix(in srgb, var(--muted) 10%, transparent)",
                            color: "var(--muted)", border: "1px solid color-mix(in srgb, var(--muted) 20%, transparent)",
                            fontWeight: 600,
                          }}>
                            {r.answered === "pending" ? t("En attente") : t("—")}
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {fmtDate(r.sent_at)}
                          {r.call_at ? ` · +${fmtDelay(r.delay_secs)}` : ""}
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{
              padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg)",
              display: "flex", gap: 8, alignItems: "center",
            }}>
              <span className="muted" style={{ fontSize: 12, flex: 1 }}>
                {smsDrillSpec.rows.length} {t("message(s)")}
                {smsDrillSpec.rows.filter((r) => r.call_id).length !== smsDrillSpec.rows.length
                  ? ` · ${smsDrillSpec.rows.filter((r) => r.call_id).length} ${t("avec appel")}`
                  : ""}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{t("Cliquer sur un lead pour voir le détail de l'appel")}</span>
            </div>

            {/* In-panel call detail overlay */}
            {smsDrillSelected && smsDrillSelected.call_id && (
              <CallDetailPane
                call={smsRowToCall(smsDrillSelected)}
                leadsSource="prod"
                onBack={() => setSmsDrillSelected(null)}
              />
            )}
          </aside>

          <style jsx>{`
            @keyframes sms-drill-fade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes sms-drill-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
          `}</style>
        </div>
      )}
    </>
  );
}
