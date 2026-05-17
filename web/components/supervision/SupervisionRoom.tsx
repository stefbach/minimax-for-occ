"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
} from "@livekit/components-react";

export type SupervisionMode = "listen" | "whisper" | "barge";

type TokenResponse = {
  token: string;
  url: string;
  room: string;
  identity: string;
  mode: SupervisionMode;
};

type Props = {
  callId: string;
  mode: SupervisionMode;
  onClose: () => void;
};

function modeLabel(mode: SupervisionMode): string {
  switch (mode) {
    case "listen":
      return "Écoute discrète";
    case "whisper":
      return "Souffler à l'agent";
    case "barge":
      return "Intervenir";
  }
}

export function SupervisionRoom({ callId, mode, onClose }: Props) {
  const [conn, setConn] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(mode === "listen");

  const fetchToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/calls/${callId}/supervision/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "token_error");
      setConn(data as TokenResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callId, mode]);

  useEffect(() => {
    void fetchToken();
  }, [fetchToken]);

  const handleEnd = useCallback(() => {
    setConn(null);
    onClose();
  }, [onClose]);

  return (
    <div className="card supervision-card">
      <div className="supervision-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden style={{ fontSize: 18 }}>🎧</span>
          <strong>{modeLabel(mode)}</strong>
          <span className={`supervision-mode supervision-mode-${mode}`}>{mode}</span>
        </div>
        <button className="ghost" onClick={handleEnd}>
          Terminer la supervision
        </button>
      </div>

      {loading && <p className="muted" style={{ margin: 0 }}>Connexion à la salle…</p>}
      {error && (
        <div style={{ color: "var(--bad)", fontSize: 13 }}>
          Erreur : {error}
        </div>
      )}

      {conn && (
        <LiveKitRoom
          token={conn.token}
          serverUrl={conn.url}
          connect
          audio={false}
          video={false}
          onDisconnected={handleEnd}
        >
          <RoomAudioRenderer />
          <StartAudio label="Activer l'audio" />
          <div className="supervision-controls">
            <span className="muted" style={{ fontSize: 12 }}>
              Salle : <span className="kbd">{conn.room}</span>
            </span>
            <button
              className="ghost"
              onClick={() => setMuted((m) => !m)}
              disabled={mode === "listen"}
              title={mode === "listen" ? "Écoute discrète : micro toujours muet" : undefined}
            >
              {muted ? "Réactiver micro" : "Mute"}
            </button>
            <button className="danger" onClick={handleEnd}>
              Quitter
            </button>
          </div>
        </LiveKitRoom>
      )}
    </div>
  );
}
