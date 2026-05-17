"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  SupervisionRoom,
  type SupervisionMode,
} from "@/components/supervision/SupervisionRoom";

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

type CallDetail = {
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
  recording_url: string | null;
  transcript_url: string | null;
  disposition: string | null;
  metadata: Record<string, unknown> | null;
  agent_handle_id: string | null;
  agent_handles: AgentHandle;
  contacts: Contact;
};

type CallEvent = {
  id: string;
  at: string;
  kind: string;
  by_user_id: string | null;
  payload: Record<string, unknown> | null;
};

function stateClass(state: string): string {
  if (state === "in_progress") return "tag good";
  if (state === "ringing") return "tag accent";
  return "tag";
}

function fmtDuration(secs: number | null, fallbackStart?: string, fallbackEnd?: string | null) {
  let s = secs;
  if (s == null && fallbackStart) {
    const end = fallbackEnd ? new Date(fallbackEnd).getTime() : Date.now();
    s = Math.max(0, Math.floor((end - new Date(fallbackStart).getTime()) / 1000));
  }
  if (s == null) return "—";
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function CallDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [call, setCall] = useState<CallDetail | null>(null);
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supervisionMode, setSupervisionMode] = useState<SupervisionMode | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/calls/${id}`, { cache: "no-store" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { call: CallDetail; events: CallEvent[] };
      setCall(data.call);
      setEvents(data.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: refresh on any change to this call or its events.
  useEffect(() => {
    if (!id) return;
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`call-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calls",
          filter: `id=eq.${id}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_events",
          filter: `call_id=eq.${id}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [id, refresh]);

  const startSupervision = useCallback(
    async (mode: SupervisionMode) => {
      setSupervisionMode(mode);
      try {
        await fetch(`/api/calls/${id}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: `supervision_${mode}`,
            payload: { mode, source: "call_detail" },
          }),
        });
      } catch {
        /* ignore */
      }
    },
    [id],
  );

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Appel</h1>
        </div>
        <div className="card">
          <p className="muted">Chargement…</p>
        </div>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div>
        <div className="page-header">
          <h1>Appel</h1>
        </div>
        <div className="card">
          <p style={{ color: "var(--bad)" }}>{error ?? "Appel introuvable."}</p>
          <Link href="/calls" className="tag">
            ← Retour à la liste
          </Link>
        </div>
      </div>
    );
  }

  const isLive = ["ringing", "in_progress", "ivr", "queued"].includes(call.state);

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/calls" className="muted" style={{ fontSize: 13 }}>
            ← Appels
          </Link>
          <h1 style={{ marginTop: 6 }}>
            {call.direction === "in" ? "Entrant" : "Sortant"} · {call.from_e164 ?? "—"} → {call.to_e164 ?? "—"}
          </h1>
          <div className="subtitle" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className={stateClass(call.state)}>{call.state}</span>
            <span>Durée : <span className="kbd">{fmtDuration(call.duration_secs, call.started_at, call.ended_at)}</span></span>
            <span>Agent : {call.agent_handles?.display_name ?? "—"}</span>
          </div>
        </div>
      </div>

      {isLive && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3>Supervision</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Rejoignez la salle pour écouter, souffler à l&apos;agent, ou intervenir.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => void startSupervision("listen")}>Écouter</button>
            <button className="ghost" onClick={() => void startSupervision("whisper")}>
              Souffler
            </button>
            <button className="ghost" onClick={() => void startSupervision("barge")}>
              Intervenir
            </button>
          </div>
        </div>
      )}

      {supervisionMode && (
        <div style={{ marginBottom: 18 }}>
          <SupervisionRoom
            callId={id}
            mode={supervisionMode}
            onClose={() => setSupervisionMode(null)}
          />
        </div>
      )}

      <div className="duo">
        <div className="panel">
          <header>
            <h2>Timeline</h2>
            <div className="meta">{events.length} évènement(s)</div>
          </header>
          <div className="chat-log" style={{ minHeight: 240 }}>
            {events.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Aucun évènement.</p>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="chat-msg assistant">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{ev.kind}</strong>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {new Date(ev.at).toLocaleTimeString()}
                    </span>
                  </div>
                  {ev.payload && Object.keys(ev.payload).length > 0 && (
                    <pre style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <header>
            <h2>Transcript live</h2>
            <div className="meta">v1 : placeholder</div>
          </header>
          <div className="chat-log" style={{ minHeight: 240, justifyContent: "center", alignItems: "center" }}>
            <p className="muted" style={{ margin: 0 }}>
              transcript en attente
            </p>
          </div>
          {call.recording_url && (
            <a className="tag" href={call.recording_url} target="_blank" rel="noreferrer">
              Enregistrement
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
