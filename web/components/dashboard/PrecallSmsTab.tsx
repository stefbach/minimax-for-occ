"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { normalizeQualification } from "@/lib/qualification";
import { GLOBAL_DURATION_BUCKETS, type GlobalFilters } from "@/lib/global-filters";

// SMS tab — suivi des messages pré-appel (Wati 26/06). Une ligne par SMS /
// WhatsApp envoyé avant un appel : nom du lead, heure d'envoi, canal, statut
// d'envoi, l'appel qui a suivi (et son délai) et si le patient a décroché.
// Source : table precall_sms_log, jointe à l'appel suivant côté API.

interface SmsRow {
  id: string;
  campaign_id: string | null;
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

// Apply the dashboard's GLOBAL filter bar to an SMS row. The SMS log already
// carries everything we need for the call-level filters — attempt (Tentative),
// the resolved answered/voicemail state (Décroché), the post-call qualification
// (Qualification), the call duration (Durée) and the free text. Lead-scoped
// filters (Source / Agent / Éligibilité) need the leads table and don't apply
// to this single-AI-agent campaign view, so they're ignored here.
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

type StatusFilter = "all" | "answered" | "no_answer" | "voicemail" | "pending" | "failed";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Tous" },
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

export function PrecallSmsTab({ from, to, global }: { from: string; to: string; global?: GlobalFilters }) {
  const t = useT();
  const [rows, setRows] = useState<SmsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

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

  // Apply the dashboard's global filter bar (Tentative, Décroché, Qualification,
  // Durée, recherche) before everything else, so the KPIs AND the table reflect
  // e.g. "Tentative · 2ème" → décrochés du 2ème appel.
  const scoped = useMemo(() => rows.filter((r) => passesGlobal(r, global)), [rows, global]);

  const kpis = useMemo(() => {
    let sent = 0, failed = 0, called = 0, answered = 0, voicemail = 0;
    for (const r of scoped) {
      if (r.status === "failed") failed += 1; else sent += 1;
      if (r.call_id) called += 1;
      if (r.answered === "answered") answered += 1;          // real human only
      if (r.answered === "voicemail") voicemail += 1;
    }
    return { sent, failed, called, answered, voicemail, total: scoped.length };
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((r) => {
      if (statusFilter === "failed" && r.status !== "failed") return false;
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

  return (
    <>
      {/* KPI cards */}
      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("SMS envoyés")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{kpis.sent}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("sur la période")}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Appels passés après SMS")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--info)" }}>{kpis.called}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.sent ? Math.round((kpis.called / kpis.sent) * 100) : 0}% {t("des envois")}
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Ont décroché (humain)")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--good)" }}>✅ {kpis.answered}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.called ? Math.round((kpis.answered / kpis.called) * 100) : 0}% {t("des appels")}
            {kpis.voicemail > 0 ? ` · 📵 ${kpis.voicemail} ${t("répondeur")}` : ""}
          </div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: kpis.failed > 0 ? "var(--bad)" : undefined }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Échecs d'envoi")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: kpis.failed > 0 ? "var(--bad)" : undefined }}>{kpis.failed}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("SMS non partis")}</div>
        </div>
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
    </>
  );
}
