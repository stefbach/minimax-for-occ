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
import { useT } from "@/lib/i18n";

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

// Compact mode hides the dial pad / calls list / transfer panel and shows
// only a slim presence bar with the active call's controls. Used by the
// layout-level persistent shell so the softphone stays mounted across
// route changes without dominating the viewport on pages that aren't /desk.
export interface SoftphoneProps {
  compact?: boolean;
  onExpand?: () => void;
}

export function Softphone({ compact = false, onExpand }: SoftphoneProps = {}) {
  const toast = useToast();
  const t = useT();
  const searchParams = useSearchParams();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [handle, setHandle] = useState<Handle | null>(null);
  const [registering, setRegistering] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Optional display name passed via ?name= for context next to the
  // outbound call card.
  const [dialContactName, setDialContactName] = useState<string | null>(null);

  // Status persists across navigation via localStorage — Wati 2026-06-11:
  // Summer kept hitting "Activer mon poste" after every navigation to
  // /mes-patients then back, because state defaulted to "offline" on mount.
  // We seed from localStorage and write through on every change so the
  // active session survives client-side route changes AND full reloads.
  const [status, setStatus] = useState<PresenceStatus>(() => {
    if (typeof window === "undefined") return "offline";
    const saved = window.localStorage.getItem("axon.softphone.status");
    if (saved === "available" || saved === "busy" || saved === "away") return saved;
    return "offline";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("axon.softphone.status", status);
  }, [status]);

  // Active-call guards (Wati 2026-06-11): navigating away from /desk while a
  // call is connected unmounts the Softphone and tears down the WebRTC
  // session — the patient gets dropped mid-conversation. Two safety nets:
  //   1. beforeunload — covers tab close / refresh / hard nav.
  //   2. Document-level click capture on <a> tags + a sidebar nav guard
  //      (added below) — covers Next.js client-side navigations.
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

  // Derived: is there a live call right now? Either an inbound/transferred
  // call we're audio-bridged into (conn), or an outbound Twilio dial in a
  // non-idle state. Used by the navigation guards above + the warning
  // banner rendered in the toolbar.
  const hasActiveCall = Boolean(conn) || twilioCallState !== "idle";

  // beforeunload: warns on tab close / refresh while a call is live.
  // Browsers ignore the custom message but still show their generic
  // "Leave site?" prompt — enough to catch accidental closes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasActiveCall) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasActiveCall]);

  // Client-side navigation guard: any same-origin <a> click (sidebar
  // links, contact rows, "Ouvrir" buttons on /mes-patients) gets a
  // confirm() prompt while a call is live. We capture on the document
  // so it fires BEFORE Next.js's router takes over. External links and
  // new-tab clicks (Ctrl/⌘) are left alone.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasActiveCall) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      // Stay-on-page links (anchors, javascript:, mailto:, tel:) don't
      // tear down the React tree — skip the prompt.
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (anchor.target && anchor.target !== "_self") return;
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch {
        return;
      }
      const ok = window.confirm(
        "Un appel est en cours. Si tu changes de page, l'appel sera coupé. Continuer quand même ?",
      );
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [hasActiveCall]);

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
    // In compact mode the layout-level sticky bar shows just a thin loader
    // so it doesn't dominate every page during the initial bootstrap.
    if (compact) {
      return (
        <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
          {t("Chargement du poste…")}
        </div>
      );
    }
    return <div className="card"><p className="muted">{t("Chargement du poste…")}</p></div>;
  }

  if (!handle) {
    // Compact + no handle = a non-agent (manager / admin / supervisor) who
    // doesn't have a softphone configured. Don't pollute every page with a
    // "Poste non activé" bar they can't act on. The full /desk page still
    // shows the proper setup card via the expanded mode.
    if (compact) return null;
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h3>{t("Votre poste n'est pas encore configuré")}</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          {t("Pour recevoir et émettre des appels, un")} <em>agent_handle</em> {t("(poste agent) doit être lié à votre compte.")}
        </p>
        <p className="muted" style={{ marginTop: 4 }}>
          {t("Vous pouvez l'activer vous-même ci-dessous, ou demander à un administrateur.")}
        </p>
        {bootstrapError && (
          <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>
            {bootstrapError}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <button onClick={register} disabled={registering}>
            {registering ? t("Activation…") : t("Activer mon poste")}
          </button>
        </div>
      </div>
    );
  }

  // ── Compact bar (layout-level persistent shell) ──────────────────────
  // Renders a single slim row with status + active-call summary + the
  // controls an agent needs without opening the full panel: mute, hangup,
  // and an "Étendre" button that toggles the full UI.
  if (compact) {
    const inTwilioCall = twilioCallState !== "idle";
    return (
      <div
        className="softphone-compact"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          background: "var(--panel)",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
          minHeight: 48,
        }}
        role="region"
        aria-label="Softphone — barre persistante"
      >
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: statusColor(status),
            boxShadow: `0 0 0 3px color-mix(in srgb, ${statusColor(status)} 25%, transparent)`,
            flex: "0 0 auto",
          }}
        />
        <strong style={{ fontSize: 13 }}>{handle.display_name}</strong>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as PresenceStatus)}
          style={{ fontSize: 12, padding: "3px 6px" }}
          aria-label="Statut de présence"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Active call inline indicator */}
        {(inTwilioCall || activeCall) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
            <span
              aria-hidden
              style={{
                width: 8, height: 8, borderRadius: 999,
                background: "var(--good)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {inTwilioCall
                ? twilioCallState === "ringing" ? t("Sonne…") : t("En appel")
                : t("Appel actif")}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {inTwilioCall
                ? dialContactName || dialNumber
                : activeCall?.from_e164 || activeCall?.to_e164 || ""}
            </span>
            {inTwilioCall && (
              <>
                <button
                  className="ghost"
                  onClick={toggleTwilioMute}
                  style={{ padding: "4px 9px", fontSize: 12 }}
                  aria-label={twilioMuted ? t("🔈 Démute") : t("🔇 Mute")}
                >
                  {twilioMuted ? "🔈" : "🔇"}
                </button>
                <button
                  onClick={hangupTwilio}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    background: "var(--bad)",
                    color: "white",
                    border: "none",
                    borderRadius: 5,
                  }}
                >
                  {t("Raccrocher")}
                </button>
              </>
            )}
          </div>
        )}

        {/* Expand toggle — opens the full softphone overlay. */}
        <button
          className="ghost"
          onClick={onExpand}
          style={{ marginLeft: "auto", padding: "5px 11px", fontSize: 12 }}
          aria-label="Ouvrir le softphone complet"
        >
          {t("⤢ Étendre")}
        </button>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
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

      <div className="softphone-grid" style={activeCall ? undefined : { gridTemplateColumns: "200px 1fr" }}>
        <CallsList
          calls={calls}
          activeId={activeCall?.id ?? null}
          onSelect={(c) => setActiveCall(c)}
        />

        <div className="softphone-center" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 280px)", gap: 12, alignItems: "start" }}>
          <div className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>{t("Composer un numéro")}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <CountryPrefix
              value={dialNumber}
              onChange={setDialNumber}
            />
            <input
              type="tel"
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              placeholder="+44 7700 123456"
              style={{
                fontSize: 16,
                padding: "10px 12px",
                flex: "1 1 160px",
                minWidth: 140,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
              }}
            />
            <button
              onClick={dial}
              disabled={dialing || !/^\+\d{6,15}$/.test(dialNumber)}
              style={{ padding: "10px 16px", whiteSpace: "nowrap" }}
            >
              {dialing ? t("Appel…") : t("☎ Appeler")}
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
              {t("⌫ Effacer")}
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
                    {twilioCallState === "ringing" ? t("📞 Sonne…") : t("🔊 En conversation")}
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
                    {twilioMuted ? t("🔈 Démute") : t("🔇 Mute")}
                  </button>
                  <button
                    className="danger"
                    onClick={hangupTwilio}
                    style={{ padding: "6px 10px", fontSize: 13 }}
                  >
                    {t("Raccrocher")}
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

          <h3 style={{ marginTop: 24 }}>{t("Session vocale")}</h3>
          {!conn ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {t("Connectez-vous à votre salle LiveKit pour recevoir les appels routés vers ce poste.")}
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => void connect()} disabled={connecting}>
                  {connecting ? t("Connexion…") : t("Se connecter à la salle")}
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
          </div>{/* close left card of softphone-center grid */}

          {/* Notes pendant l'appel + qualification dialog at hangup
              (Wati June 10). Sits to the RIGHT of the dialer so the agent
              can take notes while the call rings/connects. */}
          <CallNotePanel
            e164={dialNumber}
            callActive={twilioCallState !== "idle"}
            lastCallEndedAt={lastCallEndedAt}
            lastCallId={lastCallId}
          />
        </div>{/* close softphone-center grid */}

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
      style={{ fontSize: 13, padding: "10px 4px", width: 90, flex: "0 0 90px" }}
      title="Indicatif pays"
    >
      {current === null && <option value="">🏳</option>}
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
  const t = useT();
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
      <h3>{t("Appels")}</h3>
      {calls.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t("Aucun appel récent. Passez en « available » pour recevoir les appels.")}
        </p>
      )}

      {live.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
            {t("En cours")}
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
            {t("Récents")}
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
  const t = useT();
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
        {call.direction === "in" ? t("← entrant") : t("→ sortant")} · {t("il y a ")}{formatRelative(call.started_at)}
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
  const t = useT();
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <button className="ghost" onClick={onToggleMute}>
        {muted ? t("Réactiver micro") : t("Mute")}
      </button>
      <button
        className="ghost"
        onClick={onHold}
        disabled={!onHold || onHold_busy}
        title={
          onHold_active
            ? t("Reprendre la conversation")
            : t("Mettre l'appel en attente avec musique")
        }
      >
        {onHold_busy ? "…" : onHold_active ? t("Reprendre") : "Hold"}
      </button>
      <button
        className="ghost"
        onClick={onTransfer}
        disabled={!onTransfer}
        title={t("Transférer cet appel vers un autre agent")}
      >
        {t("Transférer")}
      </button>
      <button className="danger" onClick={onHangup}>
        {t("Raccrocher")}
      </button>
    </div>
  );
}

