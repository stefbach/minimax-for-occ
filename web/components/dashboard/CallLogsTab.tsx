"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

// Call Logs tab — generic Axon call history, aligned with the OCC dashboard
// columns: Lead · Numéro · Agent(s) · Durée · Qualification · Répondu · Heure
// · Coût · Actions (🎧 listen inline, 👁 details). Recording URL and cost
// are already returned by /api/calls; the audio player is mounted on demand.

interface CallRow {
  id: string;
  direction: "inbound" | "outbound" | string;
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  recording_url: string | null;
  transcript_url: string | null;
  cost_cents: number;
  agent_handles: { display_name: string | null } | null;
  contacts: { display_name: string | null; e164: string | null } | null;
}

const STATE_FILTERS: { id: string; label: string }[] = [
  { id: "ended,failed", label: "Terminés" },
  { id: "ended", label: "Réussis" },
  { id: "failed", label: "Échecs" },
  { id: "ringing,ivr,in_progress,wrap_up", label: "En cours" },
];

const ANSWERED_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "yes", label: "Oui" },
  { id: "no", label: "Non" },
];

function fmtDuration(secs: number | null): string {
  if (!secs || secs < 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // OCC convention: DD/MM HH:MM
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtCost(cents: number): string {
  if (!cents || cents <= 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}
function counterpartyName(c: CallRow): string {
  return c.contacts?.display_name || "Inconnu";
}
function counterpartyNumber(c: CallRow): string | null {
  return (c.direction === "inbound" || c.direction === "in") ? c.from_e164 : c.to_e164;
}
// Pick a tone for the qualification tag — green for positives, red for hard
// negatives, neutral grey for everything else. Pattern-based so it works
// regardless of the tenant's naming convention.
function qualificationTone(q: string | null): string {
  if (!q) return "var(--muted)";
  const v = q.toLowerCase();
  if (/(confirm|rdv|interesse|chaud|booked)/.test(v)) return "var(--good)";
  if (/(refus|pas interesse|faux|dnc|ne pas)/.test(v)) return "var(--bad)";
  if (/(repondeur|voicemail|robot|pas de reponse|no answer)/.test(v)) return "var(--warn)";
  return "var(--accent-2)";
}

export function CallLogsTab({ from, to, direction }: { from: string; to: string; direction: string }) {
  const t = useT();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("ended,failed");
  const [answeredFilter, setAnsweredFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ state: stateFilter, limit: "250", from, to });
      if (direction !== "all") qs.set("direction", direction);
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
  }, [stateFilter, from, to, direction]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (answeredFilter === "yes" && !c.answered_at) return false;
      if (answeredFilter === "no" && c.answered_at) return false;
      if (!q) return true;
      const haystack = `${counterpartyName(c)} ${c.from_e164 ?? ""} ${c.to_e164 ?? ""} ${c.agent_handles?.display_name ?? ""} ${c.disposition ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, answeredFilter]);

  return (
    <>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
        <div>
          <label>{t("État")}</label>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            {STATE_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{t(s.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{t("Répondu")}</label>
          <select value={answeredFilter} onChange={(e) => setAnsweredFilter(e.target.value)}>
            {ANSWERED_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{t(s.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{t("Rechercher")}</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, numéro, agent, qualification…")}
          />
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t("Lead")}</th>
              <th>{t("Numéro")}</th>
              <th>{t("Agent")}</th>
              <th>{t("Durée")}</th>
              <th>{t("Qualification")}</th>
              <th>{t("Répondu")}</th>
              <th>{t("Heure")}</th>
              <th style={{ textAlign: "right" }}>{t("Coût")}</th>
              <th style={{ textAlign: "center" }}>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="muted" style={{ padding: 16, textAlign: "center" }}>{t("Chargement…")}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="muted" style={{ padding: 16, textAlign: "center" }}>
                {t("Aucun appel ne correspond aux filtres.")}
              </td></tr>
            ) : (
              filtered.map((c) => {
                const answered = Boolean(c.answered_at);
                const isOpen = openPlayer === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td>
                        <span style={{ color: (c.direction === "inbound" || c.direction === "in") ? "var(--info)" : "var(--muted)", marginRight: 4 }}>
                          {(c.direction === "inbound" || c.direction === "in") ? "↘" : "↗"}
                        </span>
                        {counterpartyName(c)}
                      </td>
                      <td className="muted" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                        {counterpartyNumber(c) ?? "—"}
                      </td>
                      <td className="muted">{c.agent_handles?.display_name ?? "—"}</td>
                      <td>
                        {fmtDuration(c.duration_secs)}
                        {c.duration_secs !== null && (
                          <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>({c.duration_secs}s)</span>
                        )}
                      </td>
                      <td>
                        {c.disposition ? (
                          <span
                            className="tag"
                            style={{
                              color: qualificationTone(c.disposition),
                              borderColor: qualificationTone(c.disposition),
                              fontSize: 11,
                            }}
                          >
                            {c.disposition.toUpperCase()}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span
                          title={answered ? t("Oui") : t("Non")}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22, height: 22, borderRadius: "50%",
                            background: answered ? "color-mix(in srgb, var(--good) 18%, transparent)" : "color-mix(in srgb, var(--bad) 18%, transparent)",
                            color: answered ? "var(--good)" : "var(--bad)",
                            fontSize: 14, fontWeight: 700,
                          }}
                        >
                          {answered ? "✓" : "✕"}
                        </span>
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                        {fmtDate(c.started_at)}
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                        {fmtCost(c.cost_cents)}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                          <button
                            type="button"
                            title={c.recording_url ? t("Écouter l'enregistrement") : t("Aucun enregistrement")}
                            disabled={!c.recording_url}
                            onClick={() => setOpenPlayer(isOpen ? null : c.id)}
                            style={{
                              padding: "4px 8px", fontSize: 14,
                              background: "transparent", border: "1px solid var(--border)",
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
                        <td colSpan={9} style={{ background: "var(--bg-2)", padding: "10px 14px" }}>
                          <audio
                            controls
                            autoPlay
                            src={c.recording_url}
                            style={{ width: "100%", maxWidth: 520 }}
                          />
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
        {filtered.length} · {t("Appels")} (max 250).
      </div>
    </>
  );
}
