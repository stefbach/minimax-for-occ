"use client";

import { useCallback, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VoiceAssistantControlBar,
  useVoiceAssistant,
  BarVisualizer,
} from "@livekit/components-react";

type Conn = { token: string; url: string; room: string };

function AssistantView() {
  const { state, audioTrack } = useVoiceAssistant();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>État: {state}</div>
      <div style={{ width: "100%", height: 96 }}>
        <BarVisualizer state={state} barCount={5} trackRef={audioTrack} />
      </div>
      <VoiceAssistantControlBar />
    </div>
  );
}

export function VoicePanel({ agentId }: { agentId: string }) {
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/token?agent_id=${encodeURIComponent(agentId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "token fetch failed");
      setConn({ token: data.token, url: data.url, room: data.room });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  if (!conn) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Cliquez pour rejoindre la salle LiveKit. Le worker MiniMax y sera dispatché et chargera la config de cet agent.
        </p>
        <button onClick={connect} disabled={loading}>
          {loading ? "Connexion…" : "Démarrer la session vocale"}
        </button>
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
      <AssistantView />
    </LiveKitRoom>
  );
}
