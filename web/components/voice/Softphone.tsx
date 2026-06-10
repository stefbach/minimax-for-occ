"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { TransferModal } from "./TransferModal";
import { ContactPanel } from "./ContactPanel";
import { ScriptPanel } from "./ScriptPanel";
import { useToast } from "@/lib/use-toast";
import { COUNTRIES, countryFor, countryFromE164 } from "@/lib/country-prefixes";
import { CallNotePanel } from "./CallNotePanel";

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
  const toast = useToast();
  const searchParams = useSearchParams();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [handle, setHandle] = useState<Handle | null>(null);
  const [registering, setRegistering] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Optional display name passed via ?name= for context next to the
  // outbound call card.
  const [dialContactName, setDialContactName] = useState<string | null>(null);

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

  // Outbound dialer state — handled via Twilio Voice SDK (WebRTC ↔ Twilio
  // ↔ PSTN), not LiveKit. Sidesteps the Elastic SIP Trunking 403s and
  // gives the human softphone a real bidirectional audio path with the
  // destination. Same pattern as CloudTalk / Aircall.
  const [dialNumber, setDialNumber] = useState("+44");
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);
  // "idle" | "ringing" | "in-progress" — Twilio call state shown to the user.
  const [twilioCallState, setTwilioCallState] = useState<
    "idle" | "ringing" | "in-progress"
  >("idle");
  const [twilioMuted, setTwilioMuted] = useState(false);
  const twilioDeviceRef = useRef<unknown>(null);
  // Tracked for the CallNotePanel — bumped to Date.now() when the
  // softphone call ends so the qualification dialog can fire once.
  const [lastCallEndedAt, setLastCallEndedAt] = useState<number | null>(null);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const twilioCallRef = useRef<unknown>(null);
  // Cached SDK module — dynamic-imported on first dial so the bundle stays
  // light for non-softphone users.
  const twilioSdkRef = useRef<typeof import("@twilio/voice-sdk") | null>(null);

  async function ensureTwilioDevice(): Promise<unknown> {
    if (twilioDeviceRef.current) return twilioDeviceRef.current;

    if (!twilioSdkRef.current) {
      twilioSdkRef.current = await import("@twilio/voice-sdk");
    }
    const { Device } = twilioSdkRef.current;

    const tokRes = await fetch("/api/desk/twilio-token", { cache: "no-store" });
    const tokJson = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tokJson.token) {
      throw new Error(tokJson.error ?? "couldn't mint Twilio Voice token");
    }

    const device = new Device(tokJson.token, {
      // Standard Twilio defaults; codec preference favours Opus for clarity.
      codecPreferences: ["opus", "pcmu"] as unknown as never[],
      logLevel: "warn",
    });

    device.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setDialError(`Twilio Device: ${msg}`);
    });

    twilioDeviceRef.current = device;
    return device;
  }

  const dial = useCallback(async () => {
    setDialing(true);
    setDialError(null);
    try {
      if (!handle) throw new Error("no agent_handle — activate the desk first");

      // Register the call in Supabase first so it appears in /calls,
      // the desk EN COURS column, per-contact history, etc. Auto-creates
      // the contact for first-time E.164s.
      let callId: string | null = null;
      try {
        const reg = await fetch("/api/desk/sdk-call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to_e164: dialNumber }),
        });
        if (reg.ok) {
          const j = await reg.json();
          callId = j.call_id as string;
        }
      } catch {
        /* if the logging endpoint fails, still let the dial go through —
           Twilio bills the call regardless, no point blocking on
           bookkeeping. */
      }

      // Twilio.Device — registers with Twilio over WebSocket if not yet.
      const device = (await ensureTwilioDevice()) as {
        connect: (opts: { params: Record<string, string> }) => Promise<{
          on: (event: string, handler: (...args: unknown[]) => void) => void;
          mute: (m: boolean) => void;
          disconnect: () => void;
        }>;
      };

      // Twilio's TwiML app receives every param we set here as form fields.
      // OrgId lets the backend geo-route the From caller-ID against
      // phone_numbers for this org. HumanFrom takes precedence — it's the
      // org's "Humain" number (see /api/desk/caller-id) so human agents
      // don't borrow the IA's campaign caller-ID for personal callbacks.
      let humanFrom = "";
      try {
        const r = await fetch("/api/desk/caller-id", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { e164: string | null };
          if (j.e164) humanFrom = j.e164;
        }
      } catch {
        /* best-effort — leave empty and let the server fall back to geo-routing */
      }

      const params: Record<string, string> = {
        To: dialNumber,
        OrgId: handle.org_id,
      };
      if (humanFrom) params.HumanFrom = humanFrom;

      const call = await device.connect({ params });
      twilioCallRef.current = call;
      setTwilioCallState("ringing");

      // Helper to patch the Supabase row as the SDK call lifecycle fires.
      const patchCall = (
        state: "in_progress" | "ended",
        disposition?: string,
      ) => {
        if (!callId) return;
        void fetch("/api/desk/sdk-call", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ call_id: callId, state, disposition }),
        }).catch(() => {});
      };

      call.on("accept", () => {
        setTwilioCallState("in-progress");
        patchCall("in_progress");
      });
      call.on("ringing", () => setTwilioCallState("ringing"));
      call.on("disconnect", () => {
        setTwilioCallState("idle");
        setTwilioMuted(false);
        twilioCallRef.current = null;
        patchCall("ended", "answered");
        // Surface the qualification dialog (CallNotePanel) — only when the
        // call actually connected, otherwise it's noise on a cancelled dial.
        if (callId) {
          setLastCallId(callId);
          setLastCallEndedAt(Date.now());
        }
      });
      call.on("cancel", () => {
        setTwilioCallState("idle");
        patchCall("ended", "cancelled");
      });
      call.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setDialError(`Twilio call: ${msg}`);
        setTwilioCallState("idle");
        patchCall("ended", "failed");
      });
    } catch (e) {
      setDialError(e instanceof Error ? e.message : String(e));
      setTwilioCallState("idle");
    } finally {
      setDialing(false);
    }
  }, [dialNumber, handle]);

  function hangupTwilio() {
    const call = twilioCallRef.current as { disconnect: () => void } | null;
    if (call) call.disconnect();
    setTwilioCallState("idle");
    setTwilioMuted(false);
    twilioCallRef.current = null;
  }

  function toggleTwilioMute() {
    const call = twilioCallRef.current as { mute: (m: boolean) => void } | null;
    if (!call) return;
    const next = !twilioMuted;
    call.mute(next);
    setTwilioMuted(next);
  }

  const padKey = useCallback((k: string) => {
    setDialNumber((n) => (n === "+44" && k === "+" ? "+" : n + k));
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

  // Tear down the Twilio Device when the softphone unmounts so we don't
  // leak the websocket connection to Twilio or the audio device.
  useEffect(() => {
    return () => {
      const device = twilioDeviceRef.current as { destroy?: () => void } | null;
      if (device?.destroy) {
        try { device.destroy(); } catch { /* noop */ }
      }
      twilioDeviceRef.current = null;
      twilioCallRef.current = null;
    };
  }, []);

  // Click-to-dial from another page (e.g. /contacts): if the URL carries
  // ?call=<e164>[&name=…], pre-fill the dial pad and fire the call as soon
  // as the agent_handle is loaded. autoDialedRef prevents re-dialing on
  // re-renders / handle refreshes after the first attempt.
  //
  // ?prefill=<e164>[&name=…] also fills the dial pad but does NOT auto-dial
  // — used by /desk's queue panes so the agent reviews context before
  // clicking ☎ Appeler explicitly.
  const autoDialedRef = useRef(false);
  useEffect(() => {
    const callParam = searchParams?.get("call");
    const prefillParam = searchParams?.get("prefill");
    const target = callParam ?? prefillParam;
    if (!target) return;
    if (!/^\+\d{6,15}$/.test(target)) return;
    setDialNumber(target);
    const nameParam = searchParams?.get("name");
    if (nameParam) setDialContactName(nameParam);
    if (callParam && handle && !autoDialedRef.current) {
      autoDialedRef.current = true;
      void dial();
    }
  }, [searchParams, handle, dial]);

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

  const connect = useCallback(async (callId?: string) => {
    setConnecting(true);
    setConnError(null);
    try {
      const url = callId
        ? `/api/desk/token?call_id=${encodeURIComponent(callId)}`
        : "/api/desk/token";
      const r = await fetch(url);
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

  // When the IA worker reassigns a campaign call to this desk (presence-aware
  // handoff), the realtime sub flips `activeCall.room_id` to the IA's room.
  // Auto-join that room over WebRTC so the human hears the PSTN caller — the
  // whole point of "transfer interne" without going through PSTN REFER.
  useEffect(() => {
    if (!activeCall?.room_id) return;
    if (status === "offline") return;
    if (conn && conn.room === activeCall.room_id) return;
    void connect(activeCall.id);
  }, [activeCall?.id, activeCall?.room_id, status, conn, connect]);

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
      toast.success(data.on_hold ? "Appel mis en attente." : "Appel repris.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setHoldError(msg);
      toast.error(`Hold : ${msg}`);
    } finally {
      setHoldBusy(false);
    }
  }, [activeCall, onHold, toast]);

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
      <div className="card" style={{ maxWidth: 560 }}>
        <h3>Votre poste n&apos;est pas encore configuré</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          Pour recevoir et émettre des appels, un <em>agent_handle</em> (poste agent)
          doit être lié à votre compte.
        </p>
        <p className="muted" style={{ marginTop: 4 }}>
          Vous pouvez l&apos;activer vous-même ci-dessous, ou demander à un
          administrateur d&apos;aller dans <strong>Admin → Utilisateurs → vous → « Activer le poste agent »</strong>.
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
            <CountryPrefix
              value={dialNumber}
              onChange={setDialNumber}
            />
            <input
              type="tel"
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              placeholder="+44 7700 123456"
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
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            {countryFromE164(dialNumber)}
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
              onClick={() => setDialNumber("+44")}
              style={{ padding: "6px 10px", fontSize: 13, marginLeft: 6 }}
            >
              Reset
            </button>
          </div>
          {/* Twilio Voice SDK call controls — visible while an outbound
              call is active. Browser ↔ Twilio ↔ PSTN, completely separate
              from the LiveKit room session shown below. */}
          {twilioCallState !== "idle" && (
            <div className="card" style={{ marginTop: 12, background: "var(--bg-2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {twilioCallState === "ringing" ? "📞 Sonne…" : "🔊 En conversation"}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {dialContactName ? `${dialContactName} · ${dialNumber}` : dialNumber}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="ghost"
                    onClick={toggleTwilioMute}
                    style={{ padding: "6px 10px", fontSize: 13 }}
                  >
                    {twilioMuted ? "🔈 Démute" : "🔇 Mute"}
                  </button>
                  <button
                    className="danger"
                    onClick={hangupTwilio}
                    style={{ padding: "6px 10px", fontSize: 13 }}
                  >
                    Raccrocher
                  </button>
                </div>
              </div>
            </div>
          )}
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
                <button onClick={() => void connect()} disabled={connecting}>
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

          {/* Phase 4: "Script en cours" — only renders if the active
              call has a script attached (campaign with script_id). */}
          <ScriptPanel callId={activeCall?.id ?? null} />

          {/* Notes pendant l'appel + qualification dialog at hangup
              (Wati June 10). Shown beside the softphone center column. */}
          <CallNotePanel
            e164={dialNumber}
            callActive={twilioCallState !== "idle"}
            lastCallEndedAt={lastCallEndedAt}
            lastCallId={lastCallId}
          />
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

/**
 * Country prefix dropdown shown to the LEFT of the dial input. Wati June 10:
 * a manual softphone user picks a country (🇬🇧 +44 / 🇲🇺 +230 / …) which
 * resets the dial field to that prefix; the auto country chip below the
 * input keeps showing the flag as they keep typing.
 */
function CountryPrefix({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = countryFor(value);
  return (
    <select
      value={current?.code ?? ""}
      onChange={(e) => {
        const c = COUNTRIES.find((x) => x.code === e.target.value);
        if (c) onChange(c.prefix);
      }}
      style={{ fontSize: 14, padding: "10px 6px" }}
      title="Indicatif pays"
    >
      {current === null && <option value="">🏳 Pays ?</option>}
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.flag} {c.prefix}
        </option>
      ))}
    </select>
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

