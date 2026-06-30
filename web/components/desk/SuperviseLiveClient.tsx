"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type AgentStatus = "available" | "busy" | "away" | "offline" | "unknown";

interface AgentCall {
  id: string;
  direction: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  from_e164: string | null;
  to_e164: string | null;
  contact_name: string | null;
}

interface AgentStatsToday {
  calls_today: number;
  avg_duration_secs: number | null;
}

interface AgentLive {
  user_id: string;
  display_name: string | null;
  email: string | null;
  status: AgentStatus;
  last_seen: string | null;
  stale_secs: number | null;
  current_call: AgentCall | null;
  stats_today: AgentStatsToday | null;
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
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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
      setLastRefresh(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totals = data?.totals ?? { online: 0, available: 0, on_call: 0, idle_too_long: 0 };

  // Split online vs offline to show offline agents collapsed at bottom.
  const online = (data?.agents ?? []).filter((a) => a.status !== "offline" && a.status !== "unknown");
  const offline = (data?.agents ?? []).filter((a) => a.status === "offline" || a.status === "unknown");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Stats bar */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center", padding: 14 }}>
        <Stat label={t("En ligne")} value={totals.online} tone="primary" />
        <Stat label={t("Disponibles")} value={totals.available} tone="ok" />
        <Stat label={t("En appel")} value={totals.on_call} tone="warn" />
        <Stat label={t("Absents")} value={totals.idle_too_long} tone="muted" />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {lastRefresh && (
            <span className="muted" style={{ fontSize: 11 }}>
              {lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button className="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={refresh}>
            ↻ {t("Rafraîchir")}
          </button>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)", padding: 12 }}>
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
        <>
          {/* Online agents */}
          {online.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: 12,
              }}
            >
              {online.map((a) => (
                <AgentCard key={a.user_id} agent={a} now={now} />
              ))}
            </div>
          )}

          {/* Offline agents — collapsed section */}
          {offline.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--muted)",
                  userSelect: "none",
                  padding: "4px 0",
                  listStyle: "none",
                }}
              >
                ▸ {t("Hors ligne")} ({offline.length})
              </summary>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 10,
                  marginTop: 10,
                  opacity: 0.6,
                }}
              >
                {offline.map((a) => (
                  <AgentCard key={a.user_id} agent={a} now={now} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function AgentCard({ agent, now }: { agent: AgentLive; now: number }) {
  const t = useT();
  const dot = statusColor(agent.status);
  const displayName = agent.display_name || agent.email || agent.user_id.slice(0, 8);
  const call = agent.current_call;
  const isInbound = call?.direction === "in";

  // Live elapsed timer for the current call.
  const callElapsedSecs = (() => {
    if (!call) return null;
    const start = call.answered_at ?? call.started_at;
    if (!start) return null;
    const startMs = Date.parse(start);
    return Number.isFinite(startMs) ? Math.max(0, Math.floor((now - startMs) / 1000)) : null;
  })();

  // Display number: for inbound calls show who called (from_e164),
  // for outbound show who we called (to_e164).
  const callParty = call
    ? call.contact_name || (isInbound ? call.from_e164 : call.to_e164) || "—"
    : null;
  const callSubline = call?.contact_name
    ? (isInbound ? call.from_e164 : call.to_e164)
    : null;

  return (
    <div
      className="card"
      style={{
        padding: 14,
        display: "grid",
        gap: 10,
        borderColor: call
          ? isInbound
            ? "#22c55e"
            : "var(--accent)"
          : "var(--border)",
        background:
          call
            ? isInbound
              ? "color-mix(in srgb, #22c55e 6%, var(--panel))"
              : "color-mix(in srgb, var(--accent) 6%, var(--panel))"
            : "var(--panel)",
      }}
    >
      {/* Agent header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: dot,
            boxShadow:
              agent.status === "busy" || agent.status === "available"
                ? `0 0 0 4px color-mix(in srgb, ${dot} 25%, transparent)`
                : undefined,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </div>
          <div
            className="muted"
            style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 }}
          >
            {statusLabel(agent.status, t)}
            {agent.email && agent.display_name && (
              <span> · {agent.email}</span>
            )}
          </div>
        </div>

        {/* Today's stats badge */}
        {agent.stats_today && agent.stats_today.calls_today > 0 && (
          <div
            style={{
              textAlign: "center",
              background: "var(--bg-2)",
              borderRadius: 8,
              padding: "4px 10px",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
              {agent.stats_today.calls_today}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
              {t("appels")}
            </div>
          </div>
        )}
      </div>

      {/* Current call details */}
      {call ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            display: "grid",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--muted)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            <span>{isInbound ? "← " + t("Appel entrant") : "→ " + t("Appel sortant")}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{callParty}</div>
          {callSubline && (
            <div className="muted" style={{ fontSize: 12 }}>{callSubline}</div>
          )}
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: isInbound ? "#22c55e" : "var(--accent)",
              marginTop: 4,
            }}
          >
            {callElapsedSecs != null ? formatMMSS(callElapsedSecs) : "—"}
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          {agent.status === "offline"
            ? formatStale(agent.stale_secs, t)
            : agent.status === "available"
              ? t("Prêt à prendre un appel")
              : agent.status === "away"
                ? t("Absent") + (agent.stale_secs != null ? ` (${formatStaleSince(agent.stale_secs)})` : "")
                : t("Inactif")}
        </div>
      )}

      {/* Today's avg duration if on call */}
      {agent.stats_today?.avg_duration_secs != null && (
        <div
          className="muted"
          style={{ fontSize: 11, borderTop: "1px solid var(--border)", paddingTop: 8 }}
        >
          {t("Durée moy.")} {formatMMSS(agent.stats_today.avg_duration_secs)}
        </div>
      )}
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
    case "available": return "var(--good, #16a34a)";
    case "busy": return "var(--accent, #f97316)";
    case "away": return "var(--warn, #eab308)";
    case "offline": return "var(--muted, #a3a3a3)";
    default: return "var(--muted, #a3a3a3)";
  }
}

function statusLabel(s: AgentStatus, t: (s: string) => string): string {
  switch (s) {
    case "available": return t("Disponible");
    case "busy": return t("Occupé");
    case "away": return t("Absent");
    case "offline": return t("Hors ligne");
    default: return t("Inconnu");
  }
}

function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatStaleSince(staleSecs: number): string {
  if (staleSecs < 60) return `${staleSecs}s`;
  if (staleSecs < 3600) return `${Math.floor(staleSecs / 60)}m`;
  return `${Math.floor(staleSecs / 3600)}h`;
}

function formatStale(staleSecs: number | null, t: (s: string) => string): string {
  if (staleSecs == null || staleSecs > 7 * 24 * 3600) return t("Hors ligne");
  return `${t("Hors ligne depuis")} ${formatStaleSince(staleSecs)}`;
}
