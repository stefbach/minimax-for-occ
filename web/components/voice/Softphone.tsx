"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { getRingtone, primeAudio } from "@/lib/ringtone";

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
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
  // Caller-ID(s) this agent may dial from (/api/desk/caller-id). When the agent
  // has several assigned outbound numbers they pick one here; otherwise it's a
  // single org default. `selectedFrom` is the chosen From for outbound calls.
  const [callerIds, setCallerIds] = useState<{ e164: string; label: string | null; is_primary: boolean }[]>([]);
  const [selectedFrom, setSelectedFrom] = useState<string>("");
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

  // Load the agent's allowed caller-ID(s) once the desk handle is up. When the
  // server returns an assigned set (numbers[]), the agent picks among them;
  // `e164` is the default. Falls back to a single org caller-ID otherwise.
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/desk/caller-id", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as {
          e164: string | null;
          numbers?: { e164: string; label: string | null; is_primary: boolean }[];
        };
        if (!alive) return;
        const list = j.numbers ?? [];
        setCallerIds(list);
        setSelectedFrom(j.e164 ?? list.find((n) => n.is_primary)?.e164 ?? list[0]?.e164 ?? "");
      } catch {
        /* best-effort — server resolves a default at dial time anyway */
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle]);

  const dial = useCallback(async (overrideNumber?: string) => {
    // Never start a second call while one is already live. twilioCallRef is a
    // ref (always current, unlike the twilioCallState closure), so this also
    // catches a duplicate auto-dial firing during an in-progress call — the
    // bug that produced phantom "ringing" rows stuck in the desk's EN COURS.
    if (twilioCallRef.current) return;
    // Dial an explicit number when given (the click-to-dial autodial passes it
    // straight in) instead of trusting the dialNumber state closure, which may
    // not have committed the freshly-set value yet.
    const numberToDial = overrideNumber ?? dialNumber;
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
          body: JSON.stringify({ to_e164: numberToDial, from_e164: selectedFrom || undefined }),
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
      // OrgId lets the server resolve the From caller-ID. HumanFrom is the
      // agent's chosen caller-ID (from the picker / their assigned set) — the
      // server validates it against the agent's assignment and overrides it if
      // it isn't theirs, so this is a hint, not a trusted value.
      let humanFrom = selectedFrom;
      if (!humanFrom) {
        // No value loaded yet (e.g. dialled before the caller-id fetch
        // resolved) — fetch on demand so the call still carries a caller-ID.
        try {
          const r = await fetch("/api/desk/caller-id", { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as { e164: string | null };
            if (j.e164) humanFrom = j.e164;
          }
        } catch {
          /* best-effort — server falls back to geo-routing */
        }
      }

      const params: Record<string, string> = {
        To: numberToDial,
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
  }, [dialNumber, handle, selectedFrom]);

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

    if (callParam) {
      // Auto-dial needs the agent_handle loaded to attribute the call. Wait
      // for it rather than stripping the URL prematurely — that would lose the
      // number before we ever dial. autoDialedRef guards re-runs within a
      // single mount; the URL strip below guards across mounts/reloads.
      if (!handle || autoDialedRef.current) return;
      autoDialedRef.current = true;
      void dial(target);
    }

    // Consume the click-to-dial params: strip them from the URL so a remount
    // or reload of /desk can't re-apply them. For ?call= this is critical —
    // otherwise the number stays in the address bar and auto-dials AGAIN on
    // the next mount (autoDialedRef only lives for one mount), which is how a
    // call "places itself" without the agent clicking and leaves a stuck
    // phantom "ringing" row. replace() (not push) keeps Back from returning
    // to the auto-dial URL.
    router.replace(pathname, { scroll: false });
  }, [searchParams, handle, dial, router, pathname]);

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
    // Pre-warm AudioContext the moment the agent goes "available" so the
    // ringtone can play without a "suspended" context when the call arrives.
    if (status === "available") primeAudio();
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

  // Mirror activeCall into a ref so refreshCalls can read the current value
  // without being re-created (and without a stale closure) on every change.
  const activeCallRef = useRef<CallRow | null>(null);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Poll calls every 5s.
  const refreshCalls = useCallback(async () => {
    if (!handle) return;
    try {
      const r = await fetch("/api/desk/calls?state=ringing,in_progress,wrap_up&limit=25");
      if (!r.ok) return;
      const list = (await r.json()) as CallRow[];
      setCalls(list);
      // First live (ringing/in_progress) call in the list, if any.
      const live = list.find(
        (c) => c.state === "ringing" || c.state === "in_progress",
      );

      // Reconcile the ContactPanel's active call against fresh data instead of
      // latching onto the first snapshot forever. The old `prev ?? live` kept
      // whatever was first elected and NEVER updated it — so when a call was
      // hung up (state→ended, so it drops out of this ringing/in_progress
      // query) the panel stayed frozen on "ringing" with the original start
      // time and no end time.
      const prev = activeCallRef.current;

      if (!prev) {
        // Nothing shown yet → elect the first live call.
        setActiveCall(live ?? null);
        return;
      }

      const fresh = list.find((c) => c.id === prev.id);
      if (fresh) {
        // Still live → refresh its fields (ringing→in_progress, answered_at…).
        setActiveCall(fresh);
        return;
      }

      if (prev.state === "ended" || prev.state === "failed") {
        // Already showing the terminal sheet. Keep it so the agent can still
        // read the outcome and add a note; switch only if a NEW call goes live.
        if (live) setActiveCall(live);
        return;
      }

      // prev just left the live list (was ringing/in_progress, now gone) → the
      // call ended. Fetch its terminal row once so the panel shows the real
      // state + end time ("Terminé : …") rather than the frozen "ringing".
      try {
        const rr = await fetch(`/api/calls/${prev.id}`);
        if (rr.ok) {
          const j = (await rr.json()) as { call?: Partial<CallRow> | null };
          const c = j.call;
          if (c && c.id) {
            setActiveCall({
              id: c.id,
              direction: c.direction ?? prev.direction,
              state: c.state ?? "ended",
              from_e164: c.from_e164 ?? prev.from_e164,
              to_e164: c.to_e164 ?? prev.to_e164,
              room_id: c.room_id ?? null,
              started_at: c.started_at ?? prev.started_at,
              answered_at: c.answered_at ?? prev.answered_at,
              ended_at: c.ended_at ?? new Date().toISOString(),
              duration_secs: c.duration_secs ?? null,
              contact_id: c.contact_id ?? prev.contact_id,
              queue_id: c.queue_id ?? prev.queue_id,
              contacts: c.contacts ?? prev.contacts,
            });
            return;
          }
        }
      } catch {
        /* fall through to electing the next live call */
      }
      setActiveCall(live ?? null);
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
  // INBOUND ringing calls are excluded — the human must explicitly click Accept.
  useEffect(() => {
    if (!activeCall?.room_id) return;
    if (activeCall.direction === "in" && activeCall.state === "ringing") return;
    if (status === "offline") return;
    if (conn && conn.room === activeCall.room_id) return;
    void connect(activeCall.id);
  }, [activeCall?.id, activeCall?.room_id, activeCall?.direction, activeCall?.state, status, conn, connect]);

  // Incoming-call ringtone. Ring while a call assigned to this agent is in
  // "ringing" state and we're online but not yet joined to its room. The
  // confirmed gap Wati flagged: the desk only ever showed a silent "Sonne…"
  // chip, so an agent on another browser tab would miss the call. Stops as
  // soon as the call is answered/ends, the agent joins, or goes offline.
  const ringingCall = useMemo(
    () => calls.find((c) => c.state === "ringing") ?? null,
    [calls],
  );
  const shouldRing =
    !!ringingCall &&
    status !== "offline" &&
    !(conn && ringingCall.room_id && conn.room === ringingCall.room_id);
  useEffect(() => {
    const ring = getRingtone();
    if (shouldRing) {
      ring.start();
      // Also nudge the browser tab title so an agent on another tab notices.
      const prevTitle = document.title;
      document.title = "📞 Appel entrant…";
      return () => {
        ring.stop();
        document.title = prevTitle;
      };
    }
    ring.stop();
    return undefined;
  }, [shouldRing]);

  // Inbound ringing call waiting for human to Accept or Decline.
  const pendingInbound = useMemo(
    () => calls.find((c) => c.direction === "in" && c.state === "ringing") ?? null,
    [calls],
  );

  const acceptCall = useCallback(
    async (call: CallRow) => {
      await connect(call.id);
      setActiveCall(call);
    },
    [connect],
  );

  const dismissCall = useCallback(
    async (callId: string) => {
      await fetch(`/api/desk/calls/${callId}/dismiss`, { method: "POST" });
      void refreshCalls();
    },
    [refreshCalls],
  );

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
          Chargement du poste…
        </div>
      );
    }
    return <div className="card"><p className="muted">Chargement du poste…</p></div>;
  }

  if (!handle) {
    // Compact + no handle = a non-agent (manager / admin / supervisor) who
    // doesn't have a softphone configured. Don't pollute every page with a
    // "Poste non activé" bar they can't act on. The full /desk page still
    // shows the proper setup card via the expanded mode.
    if (compact) return null;
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

  // ── Compact bar (layout-level persistent shell) ──────────────────────
  // Renders a single slim row with status + active-call summary + the
  // controls an agent needs without opening the full panel: mute, hangup,
  // and an "Étendre" button that toggles the full UI.
  if (compact) {
    const inTwilioCall = twilioCallState !== "idle";
    return (
      <>
        {/* ── Incoming call banner — shown on ALL pages ─────────────────── */}
        {pendingInbound && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 16px",
              background: "#1a472a",
              borderBottom: "2px solid #22c55e",
              flexWrap: "wrap",
              animation: "inbound-pulse 1s ease-in-out infinite",
            }}
          >
            <span style={{ fontSize: 20 }}>📞</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>
                Appel entrant
              </div>
              <div style={{ color: "#86efac", fontSize: 12 }}>
                {pendingInbound.from_e164 ?? "Numéro inconnu"}
              </div>
            </div>
            <button
              onClick={() => void acceptCall(pendingInbound)}
              style={{
                padding: "8px 18px",
                fontSize: 13,
                fontWeight: 700,
                background: "#22c55e",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ✓ Accepter
            </button>
            <button
              onClick={() => void dismissCall(pendingInbound.id)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                background: "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ✕ Refuser
            </button>
          </div>
        )}

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
          {(inTwilioCall || (activeCall && !pendingInbound)) && (
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
                  ? twilioCallState === "ringing" ? "Sonne…" : "En appel"
                  : "Appel actif"}
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
                    aria-label={twilioMuted ? "Démute" : "Mute"}
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
                    ☎ Raccrocher
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
            ⤢ Étendre
          </button>
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
            @keyframes inbound-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.85; }
            }
          `}</style>
        </div>
      </>
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
          onAccept={(c) => void acceptCall(c)}
          onDismiss={(id) => void dismissCall(id)}
        />

        <div className="softphone-center softphone-center-cols">
          <div className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Composer un numéro</h3>
          {/* Caller-ID — which of the agent's assigned numbers the call goes
              out on. Picker when several are assigned, else a read-only line. */}
          {callerIds.length > 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Appeler depuis :</span>
              <select
                value={selectedFrom}
                onChange={(e) => setSelectedFrom(e.target.value)}
                style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
              >
                {callerIds.map((n) => (
                  <option key={n.e164} value={n.e164}>
                    {n.e164}{n.label ? ` — ${n.label}` : ""}{n.is_primary ? " ★" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : selectedFrom ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Appeler depuis : <span className="kbd">{selectedFrom}</span>
            </div>
          ) : null}
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
              onClick={() => dial()}
              disabled={dialing || !/^\+\d{6,15}$/.test(dialNumber)}
              style={{ padding: "10px 16px", whiteSpace: "nowrap" }}
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
              {connError && (
                <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>
                  {connError}
                </div>
              )}
              {/* No manual connect button — room connection happens automatically
                  when the human clicks "Accepter" on an inbound call. */}
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {connecting
                  ? "Connexion à la salle en cours…"
                  : "En attente d'un appel entrant. Cliquez « Accepter » pour rejoindre la salle."}
              </p>
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
      <style>{`
        @keyframes inbound-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
      `}</style>

      {/* Global incoming-call banner — portaled to document.body so it shows
          even when the Softphone is mounted off-screen (on other pages). */}
      {mounted && pendingInbound && createPortal(
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "12px 20px",
            background: "#14532d",
            borderBottom: "3px solid #22c55e",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            animation: "inbound-banner-pulse 0.8s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: 24 }}>📞</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>
              Appel entrant
            </div>
            <div style={{ color: "#86efac", fontSize: 13 }}>
              {pendingInbound.from_e164 ?? "Numéro inconnu"}
            </div>
          </div>
          <button
            onClick={() => void acceptCall(pendingInbound)}
            style={{
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 700,
              background: "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
            }}
          >
            ✓ Accepter
          </button>
          <button
            onClick={() => void dismissCall(pendingInbound.id)}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              background: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
            }}
          >
            ✕ Refuser
          </button>
          <style>{`
            @keyframes inbound-banner-pulse {
              0%, 100% { background: #14532d; }
              50% { background: #166534; }
            }
          `}</style>
        </div>,
        document.body,
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
  onAccept,
  onDismiss,
}: {
  calls: CallRow[];
  activeId: string | null;
  onSelect: (c: CallRow) => void;
  onAccept: (c: CallRow) => void;
  onDismiss: (id: string) => void;
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
              onAccept={c.direction === "in" && c.state === "ringing" ? () => onAccept(c) : undefined}
              onDismiss={c.direction === "in" && c.state === "ringing" ? () => onDismiss(c.id) : undefined}
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
  onAccept,
  onDismiss,
}: {
  call: CallRow;
  active: boolean;
  onClick: () => void;
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  const isInboundRinging = call.direction === "in" && call.state === "ringing";
  return (
    <div
      style={{
        border: `1px solid ${isInboundRinging ? "#22c55e" : active ? "var(--accent)" : "var(--border-2)"}`,
        background: isInboundRinging ? "#0f2d1a" : active ? "var(--accent-soft)" : "transparent",
        borderRadius: 6,
        overflow: "hidden",
        animation: isInboundRinging ? "inbound-pulse 1s ease-in-out infinite" : undefined,
      }}
    >
      <button
        className="ghost"
        onClick={onClick}
        style={{
          textAlign: "left",
          padding: "10px 12px",
          border: "none",
          borderRadius: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          alignItems: "stretch",
          background: "transparent",
          color: isInboundRinging ? "#fff" : undefined,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: 13, color: isInboundRinging ? "#fff" : undefined }}>
            {formatPhone(call)}
          </strong>
          <span
            className="tag"
            style={{
              fontSize: 10,
              background: isInboundRinging ? "#22c55e" : undefined,
              color: isInboundRinging ? "#fff" : undefined,
            }}
          >
            {call.state}
          </span>
        </div>
        <div style={{ fontSize: 11, color: isInboundRinging ? "#86efac" : "var(--muted)" }}>
          {call.direction === "in" ? "← entrant" : "→ sortant"} · il y a {formatRelative(call.started_at)}
        </div>
      </button>
      {isInboundRinging && onAccept && onDismiss && (
        <div style={{ display: "flex", gap: 6, padding: "0 10px 10px" }}>
          <button
            onClick={(e) => { e.stopPropagation(); onAccept(); }}
            style={{
              flex: 1,
              padding: "7px",
              fontSize: 12,
              fontWeight: 700,
              background: "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            ✓ Accepter
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            style={{
              flex: 1,
              padding: "7px",
              fontSize: 12,
              background: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            ✕ Refuser
          </button>
        </div>
      )}
    </div>
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

