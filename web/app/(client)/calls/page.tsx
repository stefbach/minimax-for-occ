"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  SupervisionRoom,
  type SupervisionMode,
} from "@/components/supervision/SupervisionRoom";
import { HelpButton } from "@/components/help/HelpButton";

type AgentHandle = {
  id: string;
  display_name: string;
  kind: "ai" | "human";
} | null;

type Contact = {
  id: string;
  e164: string;
  display_name: string | null;
} | null;

type CallRow = {
  id: string;
  org_id: string;
  direction: "in" | "out";
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  room_id: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  agent_handle_id: string | null;
  agent_handles: AgentHandle;
  contacts: Contact;
};

const ACTIVE_STATES = ["ringing", "in_progress", "ivr", "queued"];
const ENDED_STATES = ["ended", "failed", "wrap_up"];

function liveDuration(c: CallRow): string {
  const start = new Date(c.answered_at ?? c.started_at).getTime();
  const end = c.ended_at ? new Date(c.ended_at).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function stateClass(state: string): string {
  if (state === "in_progress") return "tag good";
  if (state === "ringing") return "tag accent";
  return "tag";
}

function callPeer(c: CallRow): string {
  if (c.direction === "in") {
    return c.contacts?.display_name ?? c.from_e164 ?? "—";
  }
  return c.contacts?.display_name ?? c.to_e164 ?? "—";
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [supervision, setSupervision] = useState<{
    callId: string;
    mode: SupervisionMode;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/calls?limit=200", { cache: "no-store" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      const list = (await r.json()) as CallRow[];
      setCalls(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tick "now" every second so durations update for live calls.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime subscription on calls (all events).
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel("supervision-calls")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls" },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [refresh]);

  const active = useMemo(
    () => calls.filter((c) => ACTIVE_STATES.includes(c.state)),
    [calls],
  );
  const ended = useMemo(
    () => calls.filter((c) => ENDED_STATES.includes(c.state)),
    [calls],
  );

  const counts = useMemo(() => {
    const c = { ringing: 0, in_progress: 0, wrap_up: 0, queued: 0 };
    for (const row of calls) {
      if (row.state in c) {
        c[row.state as keyof typeof c]++;
      }
    }
    return c;
  }, [calls]);

  const startSupervision = useCallback(
    async (callId: string, mode: SupervisionMode) => {
      setSupervision({ callId, mode });
      // Log the action (best-effort).
      try {
        await fetch(`/api/calls/${callId}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: `supervision_${mode}`,
            payload: { mode, source: "calls_index" },
          }),
        });
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{"Calls — live supervision"}</h1>
          <div className="subtitle">
            {"Real-time view of ongoing calls. Listen, whisper, intervene."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="ghost" onClick={() => void refresh()}>
            {"Refresh"}
          </button>
          <HelpButton contextKey="calls" />
        </div>
      </div>

      <div className="grid cols-3 calls-kpis">
        <KpiCard label={"Ringing"} value={counts.ringing} tone="accent" />
        <KpiCard label={"In progress"} value={counts.in_progress} tone="good" />
        <KpiCard label={"Queued"} value={counts.queued} tone="muted" />
      </div>
      <div className="grid cols-3 calls-kpis" style={{ marginTop: 10 }}>
        <KpiCard label={"Wrap-up"} value={counts.wrap_up} tone="muted" />
        <KpiCard label={"Active total"} value={active.length} tone="accent" />
        <KpiCard label={"Ended (24h)"} value={ended.length} tone="muted" />
      </div>

      {supervision && (
        <div style={{ marginTop: 20 }}>
          <SupervisionRoom
            callId={supervision.callId}
            mode={supervision.mode}
            onClose={() => setSupervision(null)}
          />
        </div>
      )}

      <div className="card calls-grid" style={{ marginTop: 22 }}>
        <h3>{"Active calls"}</h3>
        {loading && <p className="muted">{"Loading…"}</p>}
        {error && <p style={{ color: "var(--bad)" }}>{"Error:"} {error}</p>}
        {!loading && !error && active.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            {"No active calls at the moment."}
          </p>
        )}
        {active.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="list">
              <thead>
                <tr>
                  <th>{"From"}</th>
                  <th>{"To"}</th>
                  <th>{"Status"}</th>
                  <th>{"Agent"}</th>
                  <th>{"Duration"}</th>
                  <th>{"Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {active.map((c) => (
                  <tr key={c.id} className="call-row live" data-now={now}>
                    <td>{c.from_e164 ?? "—"}</td>
                    <td>{c.to_e164 ?? "—"}</td>
                    <td>
                      <span className={stateClass(c.state)}>{c.state}</span>
                    </td>
                    <td>
                      {c.agent_handles ? (
                        <span>
                          {c.agent_handles.display_name}
                          <span className="muted" style={{ fontSize: 11 }}>
                            {" "}· {c.agent_handles.kind}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="kbd">{liveDuration(c)}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="ghost"
                          onClick={() => void startSupervision(c.id, "listen")}
                          title={"Silent listen"}
                        >
                          {"Listen"}
                        </button>
                        <button
                          className="ghost"
                          onClick={() => void startSupervision(c.id, "whisper")}
                          title={"Whisper to agent"}
                        >
                          {"Whisper"}
                        </button>
                        <button
                          className="ghost"
                          onClick={() => void startSupervision(c.id, "barge")}
                          title={"Barge into call"}
                        >
                          {"Barge in"}
                        </button>
                        <Link
                          href={`/calls/${c.id}`}
                          className="tag"
                          style={{ textDecoration: "none" }}
                        >
                          {"Details"}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <button
          className="ghost"
          onClick={() => setHistoryOpen((v) => !v)}
          style={{ width: "100%", textAlign: "left" }}
        >
          {historyOpen ? "▾" : "▸"} {"Last 24h history"} ({ended.length})
        </button>
        {historyOpen && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            {ended.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {"No ended calls in this period."}
              </p>
            ) : (
              <table className="list">
                <thead>
                  <tr>
                    <th>{"Peer"}</th>
                    <th>{"Direction"}</th>
                    <th>{"Status"}</th>
                    <th>{"Agent"}</th>
                    <th>{"Duration"}</th>
                    <th>{"Ended"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ended.map((c) => (
                    <tr key={c.id}>
                      <td>{callPeer(c)}</td>
                      <td>{c.direction === "in" ? "Inbound" : "Outbound"}</td>
                      <td>
                        <span className="tag">{c.state}</span>
                      </td>
                      <td>{c.agent_handles?.display_name ?? "—"}</td>
                      <td>
                        <span className="kbd">
                          {c.duration_secs != null
                            ? `${Math.floor(c.duration_secs / 60)
                                .toString()
                                .padStart(2, "0")}:${(c.duration_secs % 60)
                                .toString()
                                .padStart(2, "0")}`
                            : "—"}
                        </span>
                      </td>
                      <td>
                        {c.ended_at
                          ? new Date(c.ended_at).toLocaleTimeString()
                          : "—"}
                      </td>
                      <td>
                        <Link href={`/calls/${c.id}`} className="tag">
                          {"Details"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "good" | "muted";
}) {
  const color =
    tone === "accent"
      ? "var(--accent-2)"
      : tone === "good"
        ? "var(--good)"
        : "var(--muted)";
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}
