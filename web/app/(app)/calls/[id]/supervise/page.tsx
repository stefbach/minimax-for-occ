"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
} from "@livekit/components-react";

type SupervisionMode = "listen" | "whisper" | "barge";

type TokenResponse = {
  token: string;
  url: string;
  room: string;
  identity: string;
  mode: SupervisionMode;
};

const MODE_LABELS: Record<SupervisionMode, string> = {
  listen: "Écoute discrète",
  whisper: "Souffler à l'agent",
  barge: "Intervenir",
};

const MODE_DESCRIPTIONS: Record<SupervisionMode, string> = {
  listen:
    "L'agent et le client ne vous entendent pas. Idéal pour le coaching silencieux.",
  whisper:
    "Seul l'agent vous entend (le client ne perçoit rien). Utile pour guider en direct.",
  barge:
    "Vous parlez à tous les participants — utilisez avec parcimonie.",
};

/**
 * /calls/[id]/supervise
 *
 * Dedicated supervision view. Mints a LiveKit token via
 * /api/calls/[id]/supervision/token, joins the call's room in hidden audio-only
 * mode, and lets the supervisor switch between Listen / Whisper / Barge. Each
 * mode change re-mints the token (the server controls publish permissions).
 */
export default function SupervisePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [mode, setMode] = useState<SupervisionMode>("listen");
  const [conn, setConn] = useState<TokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedForRef = useRef<string | null>(null);

  const fetchToken = useCallback(
    async (nextMode: SupervisionMode) => {
      if (!id) return;
      setLoading(true);
      setError(null);
      // Drop the previous room before requesting a new token so LiveKit
      // tears down the old WebSocket cleanly.
      setConn(null);
      try {
        const r = await fetch(`/api/calls/${id}/supervision/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: nextMode }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setConn(data as TokenResponse);
        fetchedForRef.current = `${id}:${nextMode}`;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!id) return;
    const key = `${id}:${mode}`;
    if (fetchedForRef.current === key) return;
    void fetchToken(mode);
  }, [id, mode, fetchToken]);

  const switchMode = useCallback(
    async (next: SupervisionMode) => {
      if (next === mode) return;
      setMode(next);
      try {
        await fetch(`/api/calls/${id}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: `supervision_${next}`,
            payload: { mode: next, source: "supervise_page" },
          }),
        });
      } catch {
        /* non-fatal */
      }
    },
    [id, mode],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href={`/calls/${id}`} className="muted" style={{ fontSize: 13 }}>
            ← Détail de l&apos;appel
          </Link>
          <h1 style={{ marginTop: 6 }}>Supervision</h1>
          <div className="subtitle">{MODE_DESCRIPTIONS[mode]}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>Mode</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(Object.keys(MODE_LABELS) as SupervisionMode[]).map((m) => (
            <button
              key={m}
              className={m === mode ? "" : "ghost"}
              onClick={() => void switchMode(m)}
              disabled={loading}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading && <p className="muted" style={{ margin: 0 }}>Connexion à la salle…</p>}
        {error && (
          <div style={{ color: "var(--bad)", fontSize: 13 }}>
            Erreur : {error}
            <div style={{ marginTop: 8 }}>
              <button className="ghost" onClick={() => void fetchToken(mode)}>
                Réessayer
              </button>
            </div>
          </div>
        )}
        {conn && (
          <LiveKitRoom
            token={conn.token}
            serverUrl={conn.url}
            connect
            audio={false}
            video={false}
            onDisconnected={() => setConn(null)}
          >
            <RoomAudioRenderer />
            <StartAudio label="Activer l'audio" />
            <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Salle : <span className="kbd">{conn.room}</span>
              </span>
              <span className="tag">{conn.mode}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {conn.identity}
              </span>
            </div>
          </LiveKitRoom>
        )}
      </div>
    </div>
  );
}
