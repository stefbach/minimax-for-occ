"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VoiceAssistantControlBar,
  useVoiceAssistant,
  BarVisualizer,
  useRemoteParticipants,
  useConnectionState,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { SimulationLauncher } from "./SimulationLauncher";

type Conn = { token: string; url: string; room: string };

type CheckStatus = "ok" | "fail" | "skipped";
interface CheckResult {
  service: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}
interface HealthReport {
  ok: boolean;
  agent_id: string;
  agent_name?: string;
  checks: CheckResult[];
  error?: string;
}

const AGENT_JOIN_TIMEOUT_MS = 15_000;

function DiagnosticBanner({ report, onRetry }: { report: HealthReport; onRetry: () => void }) {
  const failed = report.checks.filter((c) => c.status === "fail");
  return (
    <div
      style={{
        background: "rgba(255, 80, 80, 0.08)",
        border: "1px solid rgba(255, 80, 80, 0.4)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, color: "#ff8080" }}>
        ⚠️ L&apos;agent vocal n&apos;a pas pu démarrer
      </div>
      <div style={{ color: "var(--muted)", marginBottom: 12 }}>
        Diagnostic automatique :
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
        {report.checks.map((c) => (
          <li key={c.service} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ width: 18 }}>{c.status === "ok" ? "✅" : c.status === "fail" ? "❌" : "⏭️"}</span>
            <span style={{ flex: 1 }}>
              <strong>{c.service}</strong> — {c.message}
              {c.detail && c.status === "fail" && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {c.detail.slice(0, 200)}
                </div>
              )}
            </span>
          </li>
        ))}
      </ul>
      {failed.length > 0 && (
        <div style={{ marginTop: 12, padding: 8, background: "rgba(0,0,0,0.2)", borderRadius: 4, fontSize: 13 }}>
          <strong>Action requise :</strong>{" "}
          {failed[0].service === "MiniMax" && failed[0].message.includes("Crédit") && (
            <>recharger le crédit MiniMax sur <a href="https://platform.minimax.io" target="_blank" rel="noreferrer">platform.minimax.io</a></>
          )}
          {failed[0].service === "DeepSeek" && failed[0].message.includes("Crédit") && (
            <>recharger le crédit DeepSeek sur <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">platform.deepseek.com</a></>
          )}
          {failed[0].service === "Config agent" && (
            <>compléter la configuration de l&apos;agent (voix, modèle, LLM)</>
          )}
          {failed[0].message.includes("invalide") && (
            <>vérifier la clé API {failed[0].service} dans les variables d&apos;environnement</>
          )}
          {failed[0].message.includes("injoignable") && (
            <>service {failed[0].service} indisponible, réessayer plus tard</>
          )}
        </div>
      )}
      <button onClick={onRetry} style={{ marginTop: 12 }}>
        Réessayer
      </button>
    </div>
  );
}

function AssistantView({ agentId, onAgentJoinTimeout }: { agentId: string; onAgentJoinTimeout: () => void }) {
  const { state, audioTrack } = useVoiceAssistant();
  const participants = useRemoteParticipants();
  const connectionState = useConnectionState();

  // Detect if the agent has joined: a remote participant whose identity
  // starts with "agent-" or who publishes a track.
  const agentPresent = participants.some(
    (p) => p.identity.startsWith("agent-") || p.identity.includes("voice-agent"),
  );

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) return;
    if (agentPresent) return;
    const t = setTimeout(() => {
      if (!agentPresent) onAgentJoinTimeout();
    }, AGENT_JOIN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connectionState, agentPresent, onAgentJoinTimeout]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        État: {state}
        {!agentPresent && connectionState === ConnectionState.Connected && (
          <span style={{ marginLeft: 8, color: "#ffa500" }}>— en attente de l&apos;agent…</span>
        )}
      </div>
      <div style={{ width: "100%", height: 96 }}>
        <BarVisualizer state={state} barCount={5} trackRef={audioTrack} />
      </div>
      <VoiceAssistantControlBar />
    </div>
  );
}

export function VoicePanel({
  agentId,
  systemPrompt,
  greeting,
  scriptId,
}: {
  agentId: string;
  /** Optional: the agent's system prompt — when provided, a Simulation
   *  launcher detects {{vars}} and lets the operator fill them in before
   *  connecting. Omit for a plain "Start session" button (legacy behavior). */
  systemPrompt?: string | null;
  /** Optional: the agent's greeting — scanned for {{vars}} alongside the
   *  system prompt. */
  greeting?: string | null;
  /** Optional: simulate a specific Script (by id). The worker renders it
   *  into the prompt — including multi-agent handoffs. */
  scriptId?: string | null;
}) {
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const connect = useCallback(async (simulationVars?: Record<string, string>) => {
    setLoading(true);
    setError(null);
    setHealth(null);
    try {
      const params = new URLSearchParams({ agent_id: agentId });
      if (scriptId) params.set("script_id", scriptId);
      if (simulationVars && Object.keys(simulationVars).length > 0) {
        // Strip empty strings so the worker treats them as "not provided"
        // and leaves the {{placeholder}} literal in the prompt (helpful for
        // catching missed fields during a sim).
        const trimmed: Record<string, string> = {};
        for (const [k, v] of Object.entries(simulationVars)) {
          if (v && v.trim() !== "") trimmed[k] = v.trim();
        }
        if (Object.keys(trimmed).length > 0) {
          params.set("vars", JSON.stringify(trimmed));
        }
      }
      const res = await fetch(`/api/token?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "token fetch failed");
      setConn({ token: data.token, url: data.url, room: data.room });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentId, scriptId]);

  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/health`);
      const data = (await res.json()) as HealthReport;
      setHealth(data);
    } catch (e) {
      setHealth({
        ok: false,
        agent_id: agentId,
        error: e instanceof Error ? e.message : String(e),
        checks: [
          { service: "Diagnostic", status: "fail", message: "Impossible d'exécuter le diagnostic", detail: String(e) },
        ],
      });
    } finally {
      setHealthLoading(false);
    }
  }, [agentId]);

  const onAgentJoinTimeout = useCallback(() => {
    // Agent didn't join within the timeout — disconnect and run diagnostics.
    setConn(null);
    runHealthCheck();
  }, [runHealthCheck]);

  const retry = useCallback(() => {
    setHealth(null);
    connect();
  }, [connect]);

  // Show the Simulation launcher when we have prompt content to inspect for
  // {{vars}}; otherwise fall back to the plain "Start session" button.
  const hasPromptContent = Boolean((systemPrompt && systemPrompt.length > 0) || (greeting && greeting.length > 0));

  if (!conn) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch" }}>
        {health && <DiagnosticBanner report={health} onRetry={retry} />}
        {healthLoading && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Diagnostic en cours…
          </div>
        )}
        {hasPromptContent ? (
          <SimulationLauncher
            systemPrompt={systemPrompt}
            greeting={greeting}
            onStart={(vars) => connect(vars)}
            disabled={loading}
          />
        ) : (
          <>
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Cliquez pour rejoindre la salle LiveKit. Le worker y sera dispatché et chargera la config de cet agent.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => connect()} disabled={loading}>
                {loading ? "Connexion…" : "Démarrer la session vocale"}
              </button>
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={runHealthCheck} disabled={healthLoading} style={{ background: "transparent", border: "1px solid var(--muted)" }}>
            {healthLoading ? "Diagnostic…" : "Tester les services"}
          </button>
        </div>
        {error && <div style={{ color: "#ff8080" }}>{error}</div>}
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio
      video={false}
      onDisconnected={() => setConn(null)}
    >
      <RoomAudioRenderer />
      <StartAudio label="Activer l'audio" />
      <AssistantView agentId={agentId} onAgentJoinTimeout={onAgentJoinTimeout} />
    </LiveKitRoom>
  );
}
