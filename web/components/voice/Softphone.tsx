"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { TransferModal } from "./TransferModal";

type PresenceStatus = "offline" | "available" | "busy" | "away";

type CallRow = {
  id: string;
  direction: "in" | "out";
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  room_id: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  contact_id: string | null;
  queue_id: string | null;
  contacts?: { id: string; e164: string; display_name: string | null } | null;
};

type Conn = { token: string; url: string; room: string; agent_handle_id: string };

type Handle = { id: string; org_id: string; display_name: string };

type ActiveCallExt = CallRow & { agent_handle_id?: string | null };

const STATUSES: PresenceStatus[] = ["available", "busy", "away", "offline"];

function statusColor(s: PresenceStatus): string {
  switch (s) {
    case "available":
      return "var(--good)";
    case "busy":
      return "var(--bad)";
    case "away":
      return "var(--warn)";
    default:
      return "var(--muted-2)";
  }
}

function formatPhone(call: CallRow): string {
  const e164 = call.direction === "in" ? call.from_e164 : call.to_e164;
  if (call.contacts?.display_name) return call.contacts.display_name;
  return e164 ?? "—";
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

export function Softphone() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [handle, setHandle] = useState<Handle | null>(null);
  const [registering, setRegistering] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const [status, setStatus] = useState<PresenceStatus>("offline");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [activeCall, setActiveCall] = useState<CallRow | null>(null);
  const [conn, setConn] = useState<Conn | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);

  // Outbound dialer state
  const [dialNumber, setDialNumber] = useState("+33");
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);

  const dial = useCallback(async () => {
    setDialing(true);
    setDialError(null);
    try {
      const r = await fetch("/api/desk/dial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to_e164: dialNumber }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "dial failed");
    } catch (e) {
      setDialError(e instanceof Error ? e.message : String(e));
    } finally {
      setDialing(false);
    }
  }, [dialNumber]);

  const padKey = useCallback((k: string) => {
    setDialNumber((n) => (n === "+33" && k === "+" ? "+" : n + k));
  }, []);

  // Bootstrap: figure out if user has a human agent_handle.
  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      const sb = supabaseBrowser();
      const { data: userRes } = await sb.auth.getUser();
      const user = userRes.user;
      if (!user) {
        setBootstrapError("Vous devez être connecté.");
        return;
      }
      setUserId(user.id);
      const { data, error } = await sb
        .from("agent_handles")
        .select("id, org_id, display_name")
        .eq("kind", "human")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setHandle(data as Handle);
      } else {
        setHandle(null);
      }
    } catch (e) {
      setBootstrapError(e instanceof Error ? e.message : String(e));
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const register = useCallback(async () => {
    setRegistering(true);
    setBootstrapError(null);
    try {
      const r = await fetch("/api/desk/register", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "register failed");
      setHandle({ id: data.id, org_id: data.org_id, display_name: data.display_name });
    } catch (e) {
      setBootstrapError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }, []);

  // Push presence to the server when status changes (debounced via state).
  useEffect(() => {
    if (!handle) return;
    void fetch("/api/desk/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }, [status, handle]);

  // Heartbeat presence every 25s while not offline.
  useEffect(() => {
    if (!handle || status === "offline") return;
    const t = setInterval(() => {
      void fetch("/api/desk/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => {});
    }, 25_000);
    return () => clearInterval(t);
  }, [handle, status]);

  // Mark offline on unmount.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    return () => {
      if (statusRef.current !== "offline") {
        const blob = new Blob([JSON.stringify({ status: "offline" })], {
          type: "application/json",
        });
        try {
          navigator.sendBeacon?.("/api/desk/presence", blob);
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  // Poll calls every 5s.
  const refreshCalls = useCallback(async () => {
    if (!handle) return;
    try {
      const r = await fetch("/api/desk/calls?state=ringing,in_progress,wrap_up&limit=25");
      if (!r.ok) return;
      const list = (await r.json()) as CallRow[];
      setCalls(list);
      // Auto-elect the first ringing/in_progress call as "active" if none.
      const live = list.find(
        (c) => c.state === "ringing" || c.state === "in_progress",
      );
      setActiveCall((prev) => prev ?? live ?? null);
    } catch {
      /* ignore */
    }
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    void refreshCalls();
    const t = setInterval(refreshCalls, 5_000);
    return () => clearInterval(t);
  }, [handle, refreshCalls]);

  // Realtime subscription on calls for this agent_handle_id.
  useEffect(() => {
    if (!handle) return;
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`desk-calls-${handle.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calls",
          filter: `agent_handle_id=eq.${handle.id}`,
        },
        () => {
          void refreshCalls();
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [handle, refreshCalls]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnError(null);
    try {
      const r = await fetch("/api/desk/token");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "token error");
      setConn({
        token: data.token,
        url: data.url,
        room: data.room,
        agent_handle_id: data.agent_handle_id,
      });
    } catch (e) {
      setConnError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setConn(null);
    setMuted(false);
  }, []);

  const toggleHold = useCallback(async () => {
    if (!activeCall) return;
    setHoldBusy(true);
    setHoldError(null);
    try {
      const r = await fetch(`/api/calls/${activeCall.id}/hold`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume: onHold }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setOnHold(Boolean(data.on_hold));
    } catch (e) {
      setHoldError(e instanceof Error ? e.message : String(e));
    } finally {
      setHoldBusy(false);
    }
  }, [activeCall, onHold]);

  // Reset hold state whenever the active call changes / ends.
  useEffect(() => {
    setOnHold(false);
    setHoldError(null);
  }, [activeCall?.id]);

  // ── Render guards ──────────────────────────────────────────────────────
  if (bootstrapping) {
    return <div className="card"><p className="muted">Chargement du poste…</p></div>;
  }

  if (!handle) {
    return (
      <div className="card" style={{ maxWidth: 520 }}>
        <h3>Activer mon poste</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          Aucun handle « agent humain » n&apos;est associé à votre compte. Activez votre
          poste pour recevoir des appels routés par les files d&apos;attente.
        </p>
        {bootstrapError && (
          <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>
            {bootstrapError}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <button onClick={register} disabled={registering}>
            {registering ? "Activation…" : "Activer mon poste"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="softphone">
      <div className="softphone-presence">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: statusColor(status),
              boxShadow: `0 0 0 3px color-mix(in srgb, ${statusColor(status)} 25%, transparent)`,
            }}
          />
          <strong>{handle.display_name}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            · poste {handle.id.slice(0, 8)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              className={s === status ? "" : "ghost"}
              onClick={() => setStatus(s)}
              style={{ padding: "6px 10px", fontSize: 13 }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="softphone-grid">
        <CallsList
          calls={calls}
          activeId={activeCall?.id ?? null}
          onSelect={(c) => setActiveCall(c)}
        />

        <div className="card softphone-center">
          <h3>Composer un numéro</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="tel"
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              placeholder="+33756123456"
              style={{ flex: 1, fontSize: 16, padding: "10px 12px" }}
            />
            <button
              onClick={dial}
              disabled={dialing || !/^\+\d{6,15}$/.test(dialNumber)}
              style={{ padding: "10px 16px" }}
            >
              {dialing ? "Appel…" : "☎ Appeler"}
            </button>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
            marginTop: 12,
            maxWidth: 280,
          }}>
            {["1","2","3","4","5","6","7","8","9","*","0","#"].map((k) => (
              <button
                key={k}
                className="ghost"
                onClick={() => padKey(k)}
                style={{ padding: "10px", fontSize: 16 }}
              >
                {k}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              className="ghost"
              onClick={() => setDialNumber((n) => n.slice(0, -1) || "+")}
              style={{ padding: "6px 10px", fontSize: 13 }}
            >
              ⌫ Effacer
            </button>
            <button
              className="ghost"
              onClick={() => setDialNumber("+33")}
              style={{ padding: "6px 10px", fontSize: 13, marginLeft: 6 }}
            >
              Reset
            </button>
          </div>
          {dialError && (
            <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>
              {dialError}
            </div>
          )}

          <h3 style={{ marginTop: 24 }}>Session vocale</h3>
          {!conn ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Connectez-vous à votre salle LiveKit pour recevoir les appels routés
                vers ce poste.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={connect} disabled={connecting}>
                  {connecting ? "Connexion…" : "Se connecter à la salle"}
                </button>
              </div>
              {connError && (
                <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>
                  {connError}
                </div>
              )}
            </>
          ) : (
            <LiveKitRoom
              token={conn.token}
              serverUrl={conn.url}
              connect
              audio
              video={false}
              onDisconnected={disconnect}
            >
              <RoomAudioRenderer />
              <StartAudio label="Activer l'audio" />
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Salle : <span className="kbd">{conn.room}</span>
              </p>
              <VoiceAssistantControlBar />
              <CallActions
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onHangup={disconnect}
                onTransfer={activeCall ? () => setShowTransfer(true) : undefined}
                onHold={activeCall ? toggleHold : undefined}
                onHold_busy={holdBusy}
                onHold_active={onHold}
              />
              {holdError && (
                <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 6 }}>
                  Hold : {holdError}
                </div>
              )}
            </LiveKitRoom>
          )}
        </div>

        <ContactPanel call={activeCall} />
      </div>

      {showTransfer && activeCall && (
        <TransferModal
          callId={activeCall.id}
          orgId={handle.org_id}
          currentAgentHandleId={
            (activeCall as ActiveCallExt).agent_handle_id ?? handle.id
          }
          excludeUserId={userId}
          onClose={() => setShowTransfer(false)}
          onTransferred={() => void refreshCalls()}
        />
      )}
    </div>
  );
}

function CallsList({
  calls,
  activeId,
  onSelect,
}: {
  calls: CallRow[];
  activeId: string | null;
  onSelect: (c: CallRow) => void;
}) {
  const live = useMemo(
    () => calls.filter((c) => c.state === "ringing" || c.state === "in_progress"),
    [calls],
  );
  const others = useMemo(
    () => calls.filter((c) => c.state !== "ringing" && c.state !== "in_progress"),
    [calls],
  );

  return (
    <div className="card softphone-left">
      <h3>Appels</h3>
      {calls.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Aucun appel récent. Passez en « available » pour recevoir les appels.
        </p>
      )}

      {live.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
            En cours
          </div>
          {live.map((c) => (
            <CallRowView
              key={c.id}
              call={c}
              active={c.id === activeId}
              onClick={() => onSelect(c)}
            />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
            Récents
          </div>
          {others.map((c) => (
            <CallRowView
              key={c.id}
              call={c}
              active={c.id === activeId}
              onClick={() => onSelect(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CallRowView({
  call,
  active,
  onClick,
}: {
  call: CallRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="ghost"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderColor: active ? "var(--accent)" : "var(--border-2)",
        background: active ? "var(--accent-soft)" : "transparent",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "stretch",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{formatPhone(call)}</strong>
        <span className="tag" style={{ fontSize: 10 }}>
          {call.state}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {call.direction === "in" ? "← entrant" : "→ sortant"} · il y a {formatRelative(call.started_at)}
      </div>
    </button>
  );
}

function CallActions({
  muted,
  onToggleMute,
  onHangup,
  onTransfer,
  onHold,
  onHold_busy,
  onHold_active,
}: {
  muted: boolean;
  onToggleMute: () => void;
  onHangup: () => void;
  onTransfer?: () => void;
  onHold?: () => void;
  onHold_busy?: boolean;
  onHold_active?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <button className="ghost" onClick={onToggleMute}>
        {muted ? "Réactiver micro" : "Mute"}
      </button>
      <button
        className="ghost"
        onClick={onHold}
        disabled={!onHold || onHold_busy}
        title={
          onHold_active
            ? "Reprendre la conversation"
            : "Mettre l'appel en attente avec musique"
        }
      >
        {onHold_busy ? "…" : onHold_active ? "Reprendre" : "Hold"}
      </button>
      <button
        className="ghost"
        onClick={onTransfer}
        disabled={!onTransfer}
        title="Transférer cet appel vers un autre agent"
      >
        Transférer
      </button>
      <button className="danger" onClick={onHangup}>
        Raccrocher
      </button>
    </div>
  );
}

function ContactPanel({ call }: { call: CallRow | null }) {
  if (!call) {
    return (
      <div className="card softphone-right">
        <h3>Fiche contact</h3>
        <p className="muted" style={{ margin: 0 }}>
          Sélectionnez un appel pour afficher la fiche contact et le transcript.
        </p>
      </div>
    );
  }
  const phone = call.direction === "in" ? call.from_e164 : call.to_e164;
  return (
    <div className="card softphone-right">
      <h3>{call.contacts?.display_name ?? phone ?? "Contact inconnu"}</h3>
      <div className="muted" style={{ fontSize: 13 }}>{phone}</div>

      <div style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 13 }}>
        <div>
          <span className="muted">État : </span>
          <span className="tag">{call.state}</span>
        </div>
        <div>
          <span className="muted">Direction : </span>
          {call.direction === "in" ? "Entrant" : "Sortant"}
        </div>
        <div>
          <span className="muted">Début : </span>
          {new Date(call.started_at).toLocaleString()}
        </div>
        {call.answered_at && (
          <div>
            <span className="muted">Répondu : </span>
            {new Date(call.answered_at).toLocaleTimeString()}
          </div>
        )}
        {call.ended_at && (
          <div>
            <span className="muted">Terminé : </span>
            {new Date(call.ended_at).toLocaleTimeString()}
          </div>
        )}
        {call.room_id && (
          <div>
            <span className="muted">Room : </span>
            <span className="kbd">{call.room_id}</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Transcript live
        </div>
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 10,
            color: "var(--muted)",
            fontSize: 13,
            minHeight: 80,
          }}
        >
          Le transcript live sera branché ici (phase suivante).
        </div>
      </div>
    </div>
  );
}
