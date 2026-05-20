"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  SupervisionRoom,
  type SupervisionMode,
} from "@/components/supervision/SupervisionRoom";
import { HandoffCard } from "@/components/calls/HandoffCard";
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
  summary?: string | null;
  summary_generated_at?: string | null;
};

type CallEvent = {
  id: string;
  at: string;
  kind: string;
  by_user_id: string | null;
  payload: Record<string, unknown> | null;
};

type TranscriptTurn = {
  id: string;
  seq: number;
  speaker: string;
  speaker_id: string | null;
  text: string;
  started_at: string;
  ended_at: string | null;
  confidence: number | null;
  language: string | null;
};

type CallAnalysis = {
  id: string;
  policy_id: string;
  result: Record<string, unknown>;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_cents: number | null;
  created_at: string;
};

type AlertRow = {
  id: string;
  severity: string;
  message: string;
  payload: Record<string, unknown> | null;
  acked: boolean;
  created_at: string;
};

type AnalysisPolicy = { id: string; name: string };

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
  const [transcripts, setTranscripts] = useState<TranscriptTurn[]>([]);
  const [analyses, setAnalyses] = useState<CallAnalysis[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [policies, setPolicies] = useState<AnalysisPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supervisionMode, setSupervisionMode] = useState<SupervisionMode | null>(
    null,
  );
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [callRes, transRes] = await Promise.all([
        fetch(`/api/calls/${id}`, { cache: "no-store" }),
        fetch(`/api/calls/${id}/transcripts`, { cache: "no-store" }),
      ]);
      if (!callRes.ok) {
        const data = await callRes.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${callRes.status}`);
      }
      const data = (await callRes.json()) as { call: CallDetail; events: CallEvent[] };
      setCall(data.call);
      setEvents(data.events);
      if (transRes.ok) {
        const tr = (await transRes.json()) as TranscriptTurn[];
        setTranscripts(tr);
      }

      // Fetch analyses + alerts + policies for this call via supabase-browser (RLS).
      const sb = supabaseBrowser();
      const [an, al, pol] = await Promise.all([
        sb.from("call_analyses").select("*").eq("call_id", id).order("created_at", { ascending: false }),
        sb.from("alerts").select("id, severity, message, payload, acked, created_at").eq("call_id", id).order("created_at", { ascending: false }),
        sb.from("analysis_policies").select("id, name"),
      ]);
      setAnalyses(((an.data as unknown) as CallAnalysis[]) ?? []);
      setAlerts(((al.data as unknown) as AlertRow[]) ?? []);
      setPolicies(((pol.data as unknown) as AnalysisPolicy[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const generateSummary = useCallback(async () => {
    setSummaryBusy(true);
    setActionMsg(null);
    try {
      const r = await fetch(`/api/calls/${id}/summary`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setActionMsg("Résumé généré.");
      await refresh();
    } catch (e) {
      setActionMsg(`Erreur résumé : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSummaryBusy(false);
    }
  }, [id, refresh]);

  const runAnalyses = useCallback(async () => {
    setAnalyzeBusy(true);
    setActionMsg(null);
    try {
      const r = await fetch(`/api/calls/${id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      const okCount = (d.results ?? []).filter((x: { ok: boolean }) => x.ok).length;
      setActionMsg(`Analyses lancées : ${okCount}/${(d.results ?? []).length} OK.`);
      await refresh();
    } catch (e) {
      setActionMsg(`Erreur analyse : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzeBusy(false);
    }
  }, [id, refresh]);

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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_transcripts",
          filter: `call_id=eq.${id}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_analyses",
          filter: `call_id=eq.${id}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alerts",
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
          <HelpButton contextKey="calls" />
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
          <HelpButton contextKey="calls" />
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
        <HelpButton contextKey="calls" />
      </div>

      {isLive && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Supervision</h2>
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

      {isLive && (
        <HandoffCard
          callId={id}
          orgId={call.org_id}
          currentAgentHandleId={call.agent_handle_id}
          onChanged={() => void refresh()}
        />
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
            <h2>Transcript</h2>
            <div className="meta">{transcripts.length} tour(s)</div>
          </header>
          <div className="chat-log" style={{ minHeight: 240, maxHeight: 480, overflowY: "auto" }}>
            {transcripts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Transcript en attente.</p>
            ) : (
              transcripts.map((t) => (
                <div key={t.id} className={`chat-msg ${t.speaker === "customer" ? "user" : "assistant"}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>{t.speaker}</strong>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {new Date(t.started_at).toLocaleTimeString()}
                      {t.language ? ` · ${t.language}` : ""}
                    </span>
                  </div>
                  <div style={{ marginTop: 4 }}>{t.text}</div>
                </div>
              ))
            )}
          </div>
          {call.recording_url && (
            <a className="tag" href={call.recording_url} target="_blank" rel="noreferrer" style={{ marginTop: 8, display: "inline-block" }}>
              Enregistrement
            </a>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Résumé LLM</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={generateSummary} disabled={summaryBusy}>
              {summaryBusy ? "Génération…" : call.summary ? "Régénérer" : "Générer le résumé"}
            </button>
            <button className="ghost" onClick={runAnalyses} disabled={analyzeBusy}>
              {analyzeBusy ? "Analyse…" : "Lancer les analyses"}
            </button>
          </div>
        </div>
        {actionMsg && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{actionMsg}</div>
        )}
        {call.summary ? (
          <p style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{call.summary}</p>
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            Aucun résumé disponible.
          </p>
        )}
        {call.summary_generated_at && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            généré le {new Date(call.summary_generated_at).toLocaleString()}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Analyses LLM ({analyses.length})</h2>
        {analyses.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aucune analyse pour cet appel. Configurez des policies puis cliquez « Lancer les analyses ».
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {analyses.map((a) => {
              const pol = policies.find((p) => p.id === a.policy_id);
              return (
                <div key={a.id} className="card" style={{ background: "var(--bg-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{pol?.name ?? a.policy_id.slice(0, 8)}</strong>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {new Date(a.created_at).toLocaleString()}
                      {a.cost_cents != null ? ` · ${(a.cost_cents / 100).toFixed(3)} $` : ""}
                    </span>
                  </div>
                  <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(a.result, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Alertes générées ({alerts.length})</h2>
        {alerts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Aucune alerte.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Sév.</th>
                <th>Message</th>
                <th>Statut</th>
                <th>Créée</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td><span className="tag">{a.severity}</span></td>
                  <td>{a.message}</td>
                  <td>
                    <span className={a.acked ? "tag" : "tag accent"}>
                      {a.acked ? "ack" : "non lu"}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
