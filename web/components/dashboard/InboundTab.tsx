"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { fixAudioDuration } from "@/lib/fix-audio-duration";

// Entrants tab — dedicated view of INBOUND calls (Wati 25/06). The Call Logs
// tab mixes inbound + outbound and is geared to the outbound prospection
// pipeline; this tab answers one question the operator asked for the new
// inbound system: "qui a répondu — un humain ou l'IA (Charlotte-Entrant) ?".
//
// "Répondu par" is derived from the call's resolved agent handle:
//   * handle kind = human            → a human agent took the call
//   * answered, handle kind = ai/—   → the AI (Charlotte-Entrant) answered
//   * never answered                 → sans réponse
// The human-first worker (agent/human_first.py) stamps the human's handle on
// pickup and clears it on ring-timeout before the AI greets, so this mapping
// stays accurate without any extra bookkeeping.

interface CallRow {
  id: string;
  direction: "inbound" | "outbound" | "in" | "out" | string;
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  recording_url: string | null;
  metadata: { qualification?: string | null } | null;
  agent_handles: { display_name: string | null; kind: string | null } | null;
  contacts: { display_name: string | null; e164: string | null } | null;
  lead?: { name: string | null } | null;
}

type AnsweredBy = "human" | "ai" | "none";

// Broad state set so the tab shows every inbound leg — terminés, échecs and
// any call still live — rather than only the "ended,failed" the Call Logs tab
// defaults to.
const INBOUND_STATES = "ended,failed,ringing,ivr,in_progress,wrap_up";

const ANSWERED_FILTERS: { id: "all" | AnsweredBy; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "human", label: "Humain" },
  { id: "ai", label: "IA" },
  { id: "none", label: "Sans réponse" },
];

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
  suivi_requis: "var(--warn)",
  autre: "var(--muted)",
};

function answeredBy(c: CallRow): AnsweredBy {
  if (!c.answered_at) return "none";
  if (c.agent_handles?.kind === "human") return "human";
  // Answered with an AI handle — or no handle at all, which for an answered
  // inbound call means the AI greeted (the human-first leg clears the handle
  // before handing back to the AI).
  return "ai";
}

function fmtDuration(secs: number | null, answered: boolean): string {
  if (!secs || secs < 0) return "—";
  if (!answered) return `ring ${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function callerName(c: CallRow): string {
  return c.lead?.name || c.contacts?.display_name || "Inconnu";
}

export function InboundTab({
  from,
  to,
  leadsSource = "prod",
  system = "all",
}: {
  from: string;
  to: string;
  direction?: string;
  leadsSource?: "prod" | "test";
  system?: "all" | "retell" | "axon";
  global?: unknown;
}) {
  const t = useT();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answeredFilter, setAnsweredFilter] = useState<"all" | AnsweredBy>("all");
  const [search, setSearch] = useState("");
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // direction=in is forced — this tab is inbound-only regardless of the
      // global direction filter. enrich=lead resolves the caller's name from
      // leads_rdv by their from_e164.
      const qs = new URLSearchParams({
        state: INBOUND_STATES,
        limit: "2000",
        from,
        to,
        leads_source: leadsSource,
        enrich: "lead",
        direction: "in",
      });
      if (system !== "all") qs.set("system", system);
      const r = await fetch(`/api/calls?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(Array.isArray(j) ? j : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, [from, to, leadsSource, system]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // KPIs reflect the whole period (every inbound call), independent of the
  // table's local filter/search below.
  const kpis = useMemo(() => {
    let human = 0;
    let ai = 0;
    let none = 0;
    for (const c of rows) {
      const a = answeredBy(c);
      if (a === "human") human += 1;
      else if (a === "ai") ai += 1;
      else none += 1;
    }
    return { total: rows.length, human, ai, none };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (answeredFilter !== "all" && answeredBy(c) !== answeredFilter) return false;
      if (!q) return true;
      const haystack = `${callerName(c)} ${c.from_e164 ?? ""} ${c.agent_handles?.display_name ?? ""} ${c.disposition ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, answeredFilter]);

  return (
    <>
      {/* ─── KPI cards: total / humain / IA / sans réponse ─── */}
      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Appels entrants")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{kpis.total}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("sur la période")}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Répondu par un humain")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--good)" }}>👤 {kpis.human}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.total ? Math.round((kpis.human / kpis.total) * 100) : 0}%
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Répondu par l'IA")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: "var(--info)" }}>🤖 {kpis.ai}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.total ? Math.round((kpis.ai / kpis.total) * 100) : 0}%
          </div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: kpis.none > 0 ? "var(--warn)" : undefined }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Sans réponse")}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: kpis.none > 0 ? "var(--warn)" : undefined }}>{kpis.none}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {kpis.total ? Math.round((kpis.none / kpis.total) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* ─── Filters: répondu par + search ─── */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Répondu par")} :</span>
          {ANSWERED_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={answeredFilter === f.id ? "" : "ghost"}
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => setAnsweredFilter(f.id)}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label>{t("Rechercher")}</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, numéro, agent…")}
          />
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>
      )}

      {/* ─── Table — inbound calls with "répondu par" ─── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t("Heure")}</th>
              <th>{t("Appelant")}</th>
              <th>{t("Numéro")}</th>
              <th>{t("Répondu par")}</th>
              <th>{t("Durée")}</th>
              <th>{t("Qualification")}</th>
              <th style={{ textAlign: "center" }}>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>{t("Chargement…")}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="muted" style={{ padding: 24, textAlign: "center" }}>
                {rows.length === 0
                  ? t("Aucun appel entrant sur cette période. Les appels entrants apparaîtront ici une fois le système activé.")
                  : t("Aucun appel ne correspond aux filtres.")}
              </td></tr>
            ) : (
              filtered.map((c) => {
                const answered = Boolean(c.answered_at);
                const by = answeredBy(c);
                const isOpen = openPlayer === c.id;
                const bucket = bucketForCall(c);
                const bucketLabel = QUAL_BUCKETS.find((b) => b.key === bucket)?.label ?? "—";
                const agentName = c.agent_handles?.display_name ?? null;
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>
                        {fmtDate(c.started_at)}
                      </td>
                      <td>
                        <span style={{ color: "var(--info)", marginRight: 4 }}>↘</span>
                        {callerName(c)}
                      </td>
                      <td className="muted" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                        {c.from_e164 ?? "—"}
                      </td>
                      <td>
                        {by === "human" ? (
                          <span style={{ color: "var(--good)", whiteSpace: "nowrap" }}>
                            👤 {agentName || t("Agent humain")}
                          </span>
                        ) : by === "ai" ? (
                          <span style={{ color: "var(--info)", whiteSpace: "nowrap" }}>
                            🤖 {agentName || t("IA")}
                          </span>
                        ) : (
                          <span className="muted" style={{ whiteSpace: "nowrap" }}>— {t("Sans réponse")}</span>
                        )}
                      </td>
                      <td>{fmtDuration(c.duration_secs, answered)}</td>
                      <td>
                        {bucket !== "autre" ? (
                          <span
                            className="tag"
                            style={{
                              color: QUAL_TONE[bucket],
                              borderColor: QUAL_TONE[bucket],
                              fontSize: 10,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {bucketLabel}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                          <button
                            type="button"
                            title={c.recording_url ? t("Écouter l'enregistrement") : t("Aucun enregistrement disponible")}
                            disabled={!c.recording_url}
                            onClick={() => setOpenPlayer(isOpen ? null : c.id)}
                            style={{
                              padding: "4px 8px", fontSize: 14,
                              background: isOpen ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "transparent",
                              border: "1px solid var(--border)",
                              borderRadius: 6, cursor: c.recording_url ? "pointer" : "not-allowed",
                              opacity: c.recording_url ? 1 : 0.35,
                            }}
                          >
                            🎧
                          </button>
                          <Link
                            href={`/calls/${c.id}`}
                            title={t("Voir les détails")}
                            style={{
                              padding: "4px 8px", fontSize: 14, lineHeight: 1,
                              border: "1px solid var(--border)", borderRadius: 6,
                              textDecoration: "none", color: "var(--text)",
                            }}
                          >
                            👁
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {isOpen && c.recording_url && (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--bg-2)", padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <audio
                              controls
                              autoPlay
                              src={`/api/dashboard/call-recording?id=${encodeURIComponent(c.id)}`}
                              style={{ flex: 1 }}
                              onLoadedMetadata={fixAudioDuration}
                            />
                            <a
                              href={`/api/dashboard/call-recording?id=${encodeURIComponent(c.id)}`}
                              download
                              className="ghost"
                              style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none", color: "var(--text)" }}
                            >
                              ⬇ {t("Télécharger")}
                            </a>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {filtered.length} / {rows.length} {t("appels entrants")}
      </div>
    </>
  );
}
