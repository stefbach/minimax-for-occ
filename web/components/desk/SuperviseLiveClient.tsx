"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type AgentStatus = "available" | "busy" | "away" | "offline" | "unknown";

interface AgentCall {
  id: string;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  to_e164: string | null;
  contact_name: string | null;
}

interface AgentLive {
  user_id: string;
  display_name: string | null;
  email: string | null;
  status: AgentStatus;
  last_seen: string | null;
  stale_secs: number | null;
  current_call: AgentCall | null;
}

interface Response {
  agents: AgentLive[];
  totals: { online: number; available: number; on_call: number; idle_too_long: number };
  server_now: string;
}

const REFRESH_MS = 5000;

export function SuperviseLiveClient() {
  const t = useT();
  const [data, setData] = useState<Response | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/supervise/agents-live", { cache: "no-store" });
      const j = (await r.json()) as Response & { error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setErr(null);
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, []);

  // Initial fetch + 5s poll.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Tick the local clock every second so the live duration on each card
  // counts up smoothly without re-fetching the API.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totals = data?.totals ?? { online: 0, available: 0, on_call: 0, idle_too_long: 0 };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", padding: 14 }}>
        <Stat label={t("En ligne")} value={totals.online} tone="primary" />
        <Stat label={t("Disponibles")} value={totals.available} tone="ok" />
        <Stat label={t("En appel")} value={totals.on_call} tone="warn" />
        <Stat label={t("Absents")} value={totals.idle_too_long} tone="muted" />
        <button className="ghost" style={{ marginLeft: "auto" }} onClick={refresh}>
          {t("Rafraîchir")}
        </button>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>
        </div>
      )}

      {!data ? (
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          {t("Chargement…")}
        </div>
      ) : data.agents.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          {t("Aucun agent humain configuré dans cette organisation.")}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {data.agents.map((a) => (
            <AgentCard key={a.user_id} agent={a} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, now }: { agent: AgentLive; now: number }) {
  const t = useT();
  const dot = statusColor(agent.status);
  const displayName = agent.display_name || agent.email || agent.user_id;

  // Live timer of the current call (since answered_at if present, else
  // started_at), updated by the parent's `now` tick every second.
  const callElapsed = (() => {
    const c = agent.current_call;
    if (!c) return null;
    const start = c.answered_at ?? c.started_at;
    if (!start) return null;
    const startMs = Date.parse(start);
    if (!Number.isFinite(startMs)) return null;
    return Math.max(0, Math.floor((now - startMs) / 1000));
  })();

  return (
    <div
      className="card"
      style={{
        padding: 14,
        display: "grid",
        gap: 10,
        borderColor: agent.current_call ? "var(--accent)" : "var(--border)",
        background: agent.status === "offline" ? "var(--bg-2)" : "transparent",
        opacity: agent.status === "offline" ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: dot,
            boxShadow: dot === "var(--accent)" ? `0 0 0 4px ${dot}22` : undefined,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName}
          </div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {statusLabel(agent.status, t)}
          </div>
        </div>
      </div>

      {agent.current_call ? (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
            {t("En appel avec")}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {agent.current_call.contact_name || agent.current_call.to_e164 || "—"}
          </div>
          {agent.current_call.to_e164 && agent.current_call.contact_name && (
            <div className="muted" style={{ fontSize: 11 }}>{agent.current_call.to_e164}</div>
          )}
          <div style={{ marginTop: 6, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>
            {callElapsed != null ? formatMMSS(callElapsed) : "—"}
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
          {agent.status === "offline"
            ? t("Hors ligne")
            : agent.status === "available"
              ? t("Prêt à prendre un appel")
              : agent.status === "away"
                ? t("Absent")
                : t("Inactif")}
        </div>
      )}

      <div className="muted" style={{ fontSize: 11 }}>
        {agent.stale_secs != null
          ? `${t("Dernier heartbeat")}: ${agent.stale_secs}s`
          : t("Pas encore vu")}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "primary" | "ok" | "warn" | "muted" }) {
  const color =
    tone === "primary"
      ? "var(--accent)"
      : tone === "ok"
        ? "var(--good)"
        : tone === "warn"
          ? "var(--warn)"
          : "var(--muted)";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function statusColor(s: AgentStatus): string {
  switch (s) {
    case "available":
      return "var(--good, #16a34a)";
    case "busy":
      return "var(--accent, #f97316)";
    case "away":
      return "var(--warn, #eab308)";
    case "offline":
      return "var(--muted, #a3a3a3)";
    default:
      return "var(--muted, #a3a3a3)";
  }
}

function statusLabel(s: AgentStatus, t: (s: string) => string): string {
  switch (s) {
    case "available":
      return t("Disponible");
    case "busy":
      return t("Occupé");
    case "away":
      return t("Absent");
    case "offline":
      return t("Hors ligne");
    default:
      return t("Inconnu");
  }
}

function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
