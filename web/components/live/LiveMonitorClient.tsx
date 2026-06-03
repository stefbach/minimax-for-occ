"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

// Live Monitor — real-time view of calls in flight, adapted to Axon's `calls`
// table (LiveKit-driven) via the existing org-scoped /api/calls route. No
// Retell, no OCC-specific logic (BMI/qualification): fully generic + tenant-safe.

const ACTIVE_STATES = "ringing,ivr,in_progress,wrap_up";
const RECENT_STATES = "ended,failed";
const ACTIVE_POLL_MS = 5000;
const RECENT_POLL_MS = 15000;

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
  agent_handles: { display_name: string | null; kind: string | null } | null;
  contacts: { e164: string | null; display_name: string | null } | null;
}

const STATE_LABEL: Record<string, string> = {
  ringing: "Sonnerie",
  ivr: "Menu vocal",
  in_progress: "En conversation",
  wrap_up: "Clôture",
  ended: "Terminé",
  failed: "Échec",
};

function counterparty(c: CallRow): string {
  const num = c.direction === "inbound" ? c.from_e164 : c.to_e164;
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

function LiveCallCard({ call, now }: { call: CallRow; now: number }) {
  const t = useT();
  // Tick from answered_at (talk time) when available, else from started_at.
  const anchor = call.answered_at || call.started_at;
  const elapsed = anchor ? Math.floor((now - new Date(anchor).getTime()) / 1000) : 0;
  const isInbound = call.direction === "inbound";

  return (
    <div className="card" style={{ position: "relative", overflow: "hidden", padding: 16 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--good, #16a34a)" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }}>{isInbound ? "↘" : "↗"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15 }}>{counterparty(call)}</strong>
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
    </div>
  );
}

export function LiveMonitorClient() {
  const t = useT();
  const [active, setActive] = useState<CallRow[]>([]);
  const [recent, setRecent] = useState<CallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const fetchActive = useCallback(async () => {
    try {
      const r = await fetch(`/api/calls?state=${ACTIVE_STATES}&limit=100`, { cache: "no-store" });
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
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const r = await fetch(`/api/calls?state=${RECENT_STATES}&limit=25`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && mounted.current) setRecent(Array.isArray(j) ? j : []);
    } catch {
      /* recent feed is best-effort */
    }
  }, []);

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

  return (
    <>
      <style>{`@keyframes ping{75%,100%{transform:scale(2);opacity:0}}`}</style>

      <div className="page-header">
        <div>
          <h1>{t("Live Monitor")}</h1>
          <div className="subtitle">
            {active.length} · {t("En cours")}
            {lastCheck && (
              <span className="muted"> · {lastCheck.toLocaleTimeString()}</span>
            )}
          </div>
        </div>
        <Link href="/calls"><button className="ghost">{t("Historique des appels →")}</button></Link>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {active.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
          <p className="muted" style={{ margin: 0 }}>
            {t("Aucun appel en cours pour le moment. Cette vue se met à jour automatiquement.")}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginBottom: 20 }}>
          {active.map((c) => (
            <LiveCallCard key={c.id} call={c} now={now} />
          ))}
        </div>
      )}

      <div className="page-header" style={{ marginTop: 8 }}>
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
                  <td>{c.direction === "inbound" ? t("↘ Entrants") : t("↗ Sortants")}</td>
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
