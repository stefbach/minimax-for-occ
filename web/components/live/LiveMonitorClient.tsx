"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

// Live Monitor — real-time view of calls in flight, adapted to Axon's `calls`
// table (LiveKit-driven) via the existing org-scoped /api/calls route. No
// Retell, no OCC-specific logic (BMI/qualification): fully generic + tenant-safe.

const ACTIVE_STATES = "ringing,ivr,in_progress,wrap_up";
const RECENT_STATES = "ended,failed";
const ACTIVE_POLL_MS = 5000;
const RECENT_POLL_MS = 15000;

const VOICEMAIL_RE = /repondeur|répondeur|voicemail|voice mail|mailbox/i;
const ROBOT_RE = /robot|automate|automatique|bot/i;

interface CallRow {
  id: string;
  direction: "inbound" | "outbound" | string;
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  metadata?: Record<string, unknown> | null;
  agent_handles: { display_name: string | null; kind: string | null } | null;
  contacts: { e164: string | null; display_name: string | null } | null;
  // CRM patient context (live monitor only, via ?enrich=lead).
  lead?: { name: string | null; bmi: number | null; source: string | null; call_count: number | null; qualification: string | null } | null;
  is_test?: boolean;
}

type AlertTone = "short" | "voicemail" | "robot";
interface RealtimeAlert {
  id: string; // call_id + tone — dedupes per session
  tone: AlertTone;
  name: string;
  message: string;
  at: string; // HH:MM
}

const STATE_LABEL: Record<string, string> = {
  ringing: "Sonnerie",
  ivr: "Menu vocal",
  in_progress: "En conversation",
  wrap_up: "Clôture",
  ended: "Terminé",
  failed: "Échec",
};

function counterpartyWithLead(c: CallRow): string {
  return c.lead?.name || counterparty(c);
}
function counterparty(c: CallRow): string {
  const num = (c.direction === "inbound" || c.direction === "in") ? c.from_e164 : c.to_e164;
  return c.contacts?.display_name || num || "—";
}

function fmtDuration(totalSecs: number): string {
  if (!Number.isFinite(totalSecs) || totalSecs < 0) totalSecs = 0;
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
}

function fmtHMS(iso: string | null): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtHM(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "--:--"
    : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function LiveCallCard({ call, now }: { call: CallRow; now: number }) {
  const t = useT();
  // Tick from answered_at (talk time) when available, else from started_at.
  const anchor = call.answered_at || call.started_at;
  const elapsed = anchor ? Math.floor((now - new Date(anchor).getTime()) / 1000) : 0;
  const isInbound = (call.direction === "inbound" || call.direction === "in");

  return (
    <div className="card" style={{ position: "relative", overflow: "hidden", padding: 16 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--good, #16a34a)" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }}>{isInbound ? "↘" : "↗"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15 }}>{counterpartyWithLead(call)}</strong>
            <span className="tag" style={{ fontSize: 10, background: call.is_test ? "color-mix(in srgb, var(--warn) 18%, transparent)" : "color-mix(in srgb, var(--good) 18%, transparent)", color: call.is_test ? "var(--warn)" : "var(--good)" }}>
              {call.is_test ? "Test" : "Prod"}
            </span>
            <span className="tag good" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--good,#16a34a)", opacity: 0.75, animation: "ping 1.2s cubic-bezier(0,0,.2,1) infinite" }} />
                <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8, borderRadius: "50%", background: "var(--good,#16a34a)" }} />
              </span>
              {t(STATE_LABEL[call.state] ?? call.state)}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
            {isInbound ? call.from_e164 : call.to_e164}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {t("Agent")} : <span style={{ color: "var(--text)" }}>{call.agent_handles?.display_name ?? "—"}</span>
            {call.agent_handles?.kind === "human" ? " 👤" : " 🤖"}
          </div>
        </div>
        <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--good,#16a34a)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {fmtDuration(elapsed)}
        </span>
      </div>

      {/* Patient context from the CRM (BMI / source / attempts), like the
          legacy live card. Only shows when the number matched a lead. */}
      {call.lead && (call.lead.bmi != null || call.lead.source || call.lead.call_count != null) && (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "color-mix(in srgb, var(--good) 8%, transparent)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 11 }}>👤 {t("Lead identifié")}</span>
            {call.lead.qualification && (
              <span className="tag" style={{ fontSize: 10 }}>{call.lead.qualification}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 6, flexWrap: "wrap" }}>
            {call.lead.bmi != null && (
              <div><div className="muted" style={{ fontSize: 10 }}>BMI</div><div style={{ fontWeight: 600, fontSize: 13 }}>{Number(call.lead.bmi).toFixed(1)}</div></div>
            )}
            {call.lead.source && (
              <div><div className="muted" style={{ fontSize: 10 }}>{t("Source")}</div><div style={{ fontWeight: 600, fontSize: 13 }}>{call.lead.source}</div></div>
            )}
            {call.lead.call_count != null && (
              <div><div className="muted" style={{ fontSize: 10 }}>{t("Appels")}</div><div style={{ fontWeight: 600, fontSize: 13 }}>{call.lead.call_count}</div></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LiveMonitorClient({ leadsSource = "prod", system = "all" }: { leadsSource?: "prod" | "test"; system?: "all" | "retell" | "axon" } = {}) {
  const sysQs = system !== "all" ? `&system=${system}` : "";
  const t = useT();
  const [active, setActive] = useState<CallRow[]>([]);
  const [recent, setRecent] = useState<CallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Stream of ended calls captured in this session (oldest first; newest at bottom).
  const [stream, setStream] = useState<CallRow[]>([]);
  // Alerts captured in this session (newest first).
  const [alerts, setAlerts] = useState<RealtimeAlert[]>([]);
  const seenEndedIds = useRef<Set<string>>(new Set());
  const seenAlertIds = useRef<Set<string>>(new Set());
  const mounted = useRef(true);

  const fetchActive = useCallback(async () => {
    try {
      // No leads_source filter on purpose: a live monitor must surface EVERY
      // active call (Prod or Test) — each card is tagged instead.
      const r = await fetch(`/api/calls?state=${ACTIVE_STATES}&limit=100${sysQs}&enrich=lead`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (mounted.current) {
        setActive(Array.isArray(j) ? j : []);
        setError(null);
        setLastCheck(new Date());
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Erreur");
    }
  }, [leadsSource, sysQs]);

  const fetchRecent = useCallback(async () => {
    try {
      const r = await fetch(`/api/calls?state=${RECENT_STATES}&limit=40${sysQs}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && mounted.current) {
        const rows: CallRow[] = Array.isArray(j) ? j : [];
        setRecent(rows);
        // Append newly-ended calls to the session stream (newest at bottom).
        const fresh = rows
          .filter((row) => !seenEndedIds.current.has(row.id))
          // Sort oldest→newest so they append in chronological order.
          .sort((a, b) => {
            const ta = a.ended_at ? new Date(a.ended_at).getTime() : 0;
            const tb = b.ended_at ? new Date(b.ended_at).getTime() : 0;
            return ta - tb;
          });
        if (fresh.length > 0) {
          for (const row of fresh) seenEndedIds.current.add(row.id);
          setStream((prev) => {
            const merged = [...prev, ...fresh];
            return merged.slice(-40);
          });
          // Detect anomalies on each fresh ended call.
          const newAlerts: RealtimeAlert[] = [];
          for (const row of fresh) {
            const name = counterparty(row);
            const dispRaw = (row.disposition || "").toString();
            const at = row.ended_at || row.started_at || new Date().toISOString();
            const meta = (row.metadata ?? {}) as Record<string, unknown>;
            const robotFlag = meta.robot_awareness === "true" || meta.robot_awareness === true;
            if (ROBOT_RE.test(dispRaw) || robotFlag) {
              const aid = `${row.id}:robot`;
              if (!seenAlertIds.current.has(aid)) {
                seenAlertIds.current.add(aid);
                newAlerts.push({ id: aid, tone: "robot", name, message: t("Robot awareness"), at: fmtHM(at) });
              }
            } else if (VOICEMAIL_RE.test(dispRaw)) {
              const aid = `${row.id}:vm`;
              if (!seenAlertIds.current.has(aid)) {
                seenAlertIds.current.add(aid);
                newAlerts.push({ id: aid, tone: "voicemail", name, message: t("Voicemail détecté"), at: fmtHM(at) });
              }
            } else if ((row.duration_secs ?? 0) < 5 && row.state === "ended") {
              const aid = `${row.id}:short`;
              if (!seenAlertIds.current.has(aid)) {
                seenAlertIds.current.add(aid);
                newAlerts.push({
                  id: aid,
                  tone: "short",
                  name,
                  message: `${t("Appel anormalement court")} (${row.duration_secs ?? 0}s)`,
                  at: fmtHM(at),
                });
              }
            }
          }
          if (newAlerts.length > 0) {
            setAlerts((prev) => [...newAlerts.reverse(), ...prev].slice(0, 30));
          }
        }
      }
    } catch {
      /* recent feed is best-effort */
    }
  }, [t, leadsSource, sysQs]);

  useEffect(() => {
    mounted.current = true;
    fetchActive();
    fetchRecent();
    const a = setInterval(fetchActive, ACTIVE_POLL_MS);
    const r = setInterval(fetchRecent, RECENT_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(a);
      clearInterval(r);
      clearInterval(tick);
    };
  }, [fetchActive, fetchRecent]);

  const heartbeat = useMemo(() => fmtHMS(lastCheck?.toISOString() ?? null), [lastCheck]);

  return (
    <>
      <style>{`@keyframes ping{75%,100%{transform:scale(2);opacity:0}}`}</style>

      <div className="page-header">
        <div>
          <h1>{t("Live Monitor")}</h1>
          <div className="subtitle">
            {active.length} · {t("En cours")}
            <span className="muted" style={{ marginLeft: 8 }}>
              ·{" "}
              <span style={{ color: lastCheck ? "var(--good)" : "var(--muted)" }}>●</span>{" "}
              {t("Connecté · vérifié à")} {heartbeat}
            </span>
          </div>
        </div>
        <Link href="/calls"><button className="ghost">{t("Historique des appels →")}</button></Link>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div
        className="live-grid"
        style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}
      >
        <style>{`
          @media (max-width: 980px) {
            .live-grid { flex-direction: column; }
            .live-grid > * { width: 100% !important; flex: 1 1 100% !important; }
          }
        `}</style>

        {/* Left column — Active calls cards */}
        <div style={{ flex: 2, minWidth: 0 }}>
          {active.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
              <p className="muted" style={{ margin: 0 }}>
                {t("Aucun appel en cours pour le moment. Cette vue se met à jour automatiquement.")}
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {active.map((c) => (
                <LiveCallCard key={c.id} call={c} now={now} />
              ))}
            </div>
          )}
        </div>

        {/* Right column — completed call stream + realtime alerts */}
        <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div
              className="muted"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}
            >
              ⏵ {t("Flux des appels terminés")}
            </div>
            {stream.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {t("Aucun appel terminé pour le moment.")}
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 4,
                  fontSize: 12,
                  fontFamily: "ui-monospace, monospace",
                  maxHeight: 260,
                  overflowY: "auto",
                }}
              >
                {stream.map((c) => {
                  const name = counterparty(c) || t("Inconnu");
                  const qual = c.disposition || (c.state === "failed" ? "failed" : "—");
                  const dur = c.duration_secs ?? 0;
                  const agent = c.agent_handles?.display_name ?? "—";
                  const ts = c.ended_at ? new Date(c.ended_at) : null;
                  const hms = ts && !Number.isNaN(ts.getTime())
                    ? ts.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                    : "--:--:--";
                  return (
                    <div key={c.id} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span className="muted">[{hms}]</span>{" "}
                      <span>{name}</span>{" "}
                      <span className="muted">—</span>{" "}
                      <span>{qual}</span>{" "}
                      <span className="muted">— {dur}s — {agent}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div
              className="muted"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}
            >
              ⚡ {t("Alertes temps réel")}
            </div>
            {alerts.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {t("Aucune alerte pour le moment.")}
              </p>
            ) : (
              <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {alerts.map((a) => {
                  const palette: Record<AlertTone, { bg: string; border: string; color: string }> = {
                    short: {
                      bg: "color-mix(in srgb, var(--warn) 12%, var(--panel))",
                      border: "color-mix(in srgb, var(--warn) 40%, var(--border))",
                      color: "var(--warn)",
                    },
                    voicemail: {
                      bg: "color-mix(in srgb, var(--info) 12%, var(--panel))",
                      border: "color-mix(in srgb, var(--info) 40%, var(--border))",
                      color: "var(--info)",
                    },
                    robot: {
                      bg: "color-mix(in srgb, var(--bad) 12%, var(--panel))",
                      border: "color-mix(in srgb, var(--bad) 40%, var(--border))",
                      color: "var(--bad)",
                    },
                  };
                  const p = palette[a.tone];
                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        background: p.bg,
                        border: `1px solid ${p.border}`,
                        fontSize: 12,
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ color: p.color, fontWeight: 600, whiteSpace: "nowrap" }}>{a.message}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.name || t("Inconnu")}
                      </span>
                      <span className="muted" style={{ whiteSpace: "nowrap" }}>{a.at}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="page-header" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t("Activité récente")}</h2>
      </div>
      {recent.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Aucun appel récent.")}</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t("Heure")}</th>
                <th>{t("Contact")}</th>
                <th>{t("Sens")}</th>
                <th>{t("Agent")}</th>
                <th>{t("Durée")}</th>
                <th>{t("État")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{fmtClock(c.started_at)}</td>
                  <td>{counterparty(c)}</td>
                  <td>{(c.direction === "inbound" || c.direction === "in") ? t("↘ Entrants") : t("↗ Sortants")}</td>
                  <td className="muted">{c.agent_handles?.display_name ?? "—"}</td>
                  <td>{fmtDuration(c.duration_secs ?? 0)}</td>
                  <td>
                    <span className={`tag${c.state === "failed" ? "" : " accent"}`} style={c.state === "failed" ? { color: "var(--bad)" } : undefined}>
                      {c.disposition || t(STATE_LABEL[c.state] || c.state)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/calls/${c.id}`}>{t("Voir")}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
