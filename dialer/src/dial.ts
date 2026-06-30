import type { SupabaseClient } from "@supabase/supabase-js";
import { SipClient, RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";
import { supabase } from "./supabase.js";
import { createCall, sendContentSms, TwilioError } from "./twilio.js";
import { countryFromE164 } from "./_phone-utils.generated.js";
import {
  parseContact,
  toDialCampaignRow,
  toDialTargetRow,
  type DialCampaignRow,
  type DialTargetRow,
} from "./types.js";

export interface DialJob {
  target_id: string;
  campaign_id: string;
}

// ─── Per-call structured logging ─────────────────────────────────────────
type LogCtx = { call_id?: string; target_id?: string; campaign_id?: string };
function prefix(ctx: LogCtx): string {
  const parts: string[] = [];
  if (ctx.call_id) parts.push(`call_id=${ctx.call_id}`);
  if (ctx.target_id) parts.push(`target=${ctx.target_id}`);
  if (ctx.campaign_id) parts.push(`campaign=${ctx.campaign_id}`);
  return parts.length > 0 ? `[${parts.join(" ")}]` : "[dial]";
}
function dlog(level: "info" | "warn" | "error", ctx: LogCtx, msg: string): void {
  const line = `${prefix(ctx)} ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}


/**
 * Org-scoped From-number picker. Returns null if the org owns nothing usable.
 * Order: country match → org default → any active number.
 */
async function pickFromNumberForOrg(
  sb: SupabaseClient,
  orgId: string,
  toE164: string,
): Promise<string | null> {
  const iso = countryFromE164(toE164);
  if (iso) {
    const { data } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("country_code", iso)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (data && data.length > 0) return (data[0] as { e164: string }).e164 ?? null;
  }
  {
    const { data } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("is_default", true)
      .limit(1);
    if (data && data.length > 0) return (data[0] as { e164: string }).e164 ?? null;
  }
  {
    const { data } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1);
    if (data && data.length > 0) return (data[0] as { e164: string }).e164 ?? null;
  }
  return null;
}

/**
 * Slot-based retry scheduling — keeps a dynamic (slot-based) campaign to ONE
 * dial per lead per slot. Returns the next slot time LATER TODAY (in the
 * campaign's slot timezone); null when there's no later slot today, which tells
 * the caller to leave the target terminal so the slot-based re-selection
 * re-arms it on the lead's next cadence day. This replaces the old
 * `now + retry_delay_min` retry, which re-fired INSIDE the (wide) schedule
 * window and dialed a no-answer lead 3-4× in a single slot instead of once.
 */
function nextSlotTodayIso(now: Date, metadata: unknown): string | null {
  const slots = (metadata as { engine?: { slots?: { hours?: string[]; timezone?: string } } } | null)?.engine?.slots;
  const hours = slots?.hours;
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const tz = slots?.timezone || "UTC";
  const mins = hours
    .map((h) => { const [a, b] = String(h).split(":").map(Number); return (a || 0) * 60 + (b || 0); })
    .filter((m) => Number.isFinite(m))
    .sort((x, y) => x - y);
  if (mins.length === 0) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const nowMin = Number(p.hour) * 60 + Number(p.minute);
  // Strictly later today (+1 min guard so the slot we're in can't re-pick).
  const target = mins.find((m) => m > nowMin + 1);
  if (target === undefined) return null;
  // London/UTC advance at the same rate, so the UTC instant is just now + delta.
  return new Date(now.getTime() + (target - nowMin) * 60_000).toISOString();
}

function isSlotBased(metadata: unknown): boolean {
  const h = (metadata as { engine?: { slots?: { hours?: string[] } } } | null)?.engine?.slots?.hours;
  return Array.isArray(h) && h.length > 0;
}

/**
 * Decide a target's retry status + time after a dial that didn't connect.
 * Slot-based campaigns retry at the NEXT SLOT (one dial per slot); static
 * campaigns keep the classic attempts/`retry_delay_min` policy.
 */
function computeRetry(
  now: Date,
  target: { attempts?: number | null },
  campaign: { metadata?: unknown; max_attempts?: number | null; retry_delay_min?: number | null },
): { status: "pending" | "no_answer" | "failed"; next_attempt_at: string | null } {
  if (isSlotBased(campaign.metadata)) {
    const slotNext = nextSlotTodayIso(now, campaign.metadata);
    return { status: slotNext ? "pending" : "no_answer", next_attempt_at: slotNext };
  }
  const attemptsNow = (target.attempts ?? 0) + 1;
  const nextAt =
    attemptsNow < (campaign.max_attempts ?? 3)
      ? new Date(now.getTime() + (campaign.retry_delay_min ?? 60) * 60_000).toISOString()
      : null;
  return { status: nextAt ? "pending" : "failed", next_attempt_at: nextAt };
}

/**
 * Preferred dial path: LiveKit-originated outbound, the way Retell-style
 * platforms avoid the "ringing tone after pickup".
 *
 * Instead of Twilio calling the contact and then bridging a SECOND SIP leg to
 * LiveKit (which rings audibly until the agent room is ready), LiveKit places
 * the call itself: we create the room, dispatch the AI agent into it, then ask
 * LiveKit to dial the contact through the outbound trunk. The answered PSTN leg
 * drops straight into the room where the agent already lives — so the contact
 * hears their phone ring normally and, on pickup, goes straight to the agent.
 * No post-answer ringback.
 *
 * Also creates the `calls` row up front so the worker receives a real call_id
 * (via room metadata) and persists transcripts / triggers the post-call
 * summary — which the Twilio-bridge path never did.
 *
 * Returns true if it originated the call; throws on hard failure so the caller
 * can fall back to the Twilio path.
 */
async function dialViaLiveKit(args: {
  sb: SupabaseClient;
  ctx: LogCtx;
  orgId: string;
  campaignId: string;
  targetId: string;
  toE164: string;
  fromE164: string | null;
  aiAgentId: string;
  handleId: string | null;
  lk: { trunk: string; host: string; key: string; secret: string };
}): Promise<void> {
  const { sb, ctx, orgId, campaignId, targetId, toE164, fromE164, aiAgentId, handleId, lk } = args;

  // 1. Create the calls row first → gives the worker a call_id for transcripts.
  const { data: call, error: callErr } = await sb
    .from("calls")
    .insert({
      org_id: orgId,
      direction: "out",
      state: "ringing",
      from_e164: fromE164,
      to_e164: toE164,
      agent_handle_id: handleId,
      metadata: { campaign_id: campaignId, target_id: targetId },
    })
    .select()
    .single();
  if (callErr || !call) throw new Error(`calls insert failed: ${callErr?.message ?? "unknown"}`);
  const callId = call.id as string;
  // Stamp last_call_id on the campaign_target NOW (don't wait for Twilio's
  // StatusCallback to land). The agent's _on_shutdown calls /api/calls/[id]/
  // sync-lead immediately after the call ends, and that endpoint resolves
  // the data_table row via campaign_targets.last_call_id. If we left it
  // NULL until the webhook arrived, leads_rdv writes would race and
  // intermittently drop on fast hangups.
  try {
    await sb
      .from("campaign_targets")
      .update({ last_call_id: callId, last_attempt_at: new Date().toISOString() })
      .eq("id", targetId);
  } catch (e) {
    // Non-fatal — sync-lead has a phone-based fallback.
    console.warn(`[dialer] target last_call_id update failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const roomName = `campaign-${targetId}-${callId.slice(0, 8)}`;

  // Routing metadata the worker resolves from (agent_id + call_id live in room
  // metadata; campaign/target also pushed onto the SIP participant attributes).
  const roomMeta = JSON.stringify({
    agent_id: aiAgentId,
    call_id: callId,
    campaign_id: campaignId,
    target_id: targetId,
    direction: "out",
  });

  // 2. Pre-create the room, place the call, THEN dispatch the agent. Order
  //    matters: we must NOT dispatch the agent before the call connects —
  //    otherwise a failed INVITE (e.g. Twilio 403) leaves a "ghost" agent
  //    alone in an empty room, which piles up and saturates the worker.
  let participant: { participantId?: string } | undefined;
  try {
    const rooms = new RoomServiceClient(lk.host, lk.key, lk.secret);
    await rooms.createRoom({ name: roomName, metadata: roomMeta, emptyTimeout: 30, departureTimeout: 20 });

    // 3. Place the outbound call FIRST. If it 403s / no-answers, this throws
    //    before any agent is dispatched (no ghost agent).
    const sip = new SipClient(lk.host, lk.key, lk.secret);
    const sipOptions = {
      participantIdentity: `pstn-${callId}`,
      participantName: toE164,
      participantAttributes: {
        "axon.call_id": callId,
        "axon.agent_id": aiAgentId,
        "axon.campaign_id": campaignId,
        "axon.target_id": targetId,
        "axon.direction": "out",
      },
      // fromNumber is the OFFICIAL SDK parameter that sets the SIP From header
      // on the INVITE LiveKit sends to Twilio. Previously this code used a made-up
      // `sipNumber` field which the SDK silently dropped, so LK fell back to the
      // outbound trunk's first registered number (axon-trunk → +447700162160).
      // Result: every call placed via campaign.phone_number_id=861445 still
      // displayed +447700162160 to the patient. With `fromNumber` we honour the
      // per-campaign caller ID, validated against the trunk's `numbers` allow-list.
      fromNumber: fromE164 ?? undefined,
      // Block until pickup/timeout so we only dispatch the agent on a real answer.
      waitUntilAnswered: true,
      // Patient ring timeout, configurable via DIAL_RING_TIMEOUT_SECS.
      // 10s default — this is Wati's validated value from the Day-Before-Go-Live
      // test plan ("Ne pas repondre, doit raccrocher automatiquement apres
      // 10sec"). Yes, a few mobile carriers ring for >10s before voicemail
      // kicks in, but on this batch lengthening to 25s ballooned PAS DE
      // REPONSE durations to 41-67s (Lauren Checkley rang for 1:03 dead-air)
      // without measurably raising the pickup rate. The "hang up fast when
      // nobody's there" requirement is enforced POST-answer by the agent
      // (speech-wait timeout + 4s idle watchdog), not by waiting on the ring.
      ringingTimeout: Math.max(5, Math.min(600, Number(process.env.DIAL_RING_TIMEOUT_SECS ?? 10))),
    };
    // ────────────────────────────────────────────────────────────────────
    // "Agent First" sequencing (Wati's architectural insight): instead of
    // creating the SIP call → waiting for pickup → dispatching the agent
    // (which leaves a 1-2s gap where the patient hears nothing useful while
    // the agent worker subscribes to audio), we:
    //   1. Pre-create the room
    //   2. Dispatch the agent and WAIT until the worker is physically in
    //      the room with its audio publisher armed
    //   3. THEN createSipParticipant outbound. When the patient answers
    //      they land in a "warm" room where the agent is already
    //      publishing, so the audio path is established before the SIP
    //      participant joins — no buffer for Twilio's residual ringback
    //      to leak into.
    // This is how Vapi / Bland / Twilio <Conference>-based platforms avoid
    // the early-media bleed-through that plain SIP outbound suffers from.
    const agentName = process.env.LIVEKIT_AGENT_NAME ?? "axon-voice-agent";
    const dispatch = new AgentDispatchClient(lk.host, lk.key, lk.secret);
    await dispatch.createDispatch(roomName, agentName, { metadata: roomMeta });

    // Poll the room until the agent worker shows up as a remote
    // participant. Bounded by AGENT_WARMUP_TIMEOUT_SECS so we never block
    // forever if the worker pool is saturated.
    const warmupTimeoutMs = Math.max(
      3000,
      Math.min(30000, Number(process.env.AGENT_WARMUP_TIMEOUT_SECS ?? 10) * 1000),
    );
    const warmupStart = Date.now();
    let agentReady = false;
    while (Date.now() - warmupStart < warmupTimeoutMs) {
      try {
        const participants = await rooms.listParticipants(roomName);
        // The agent worker's identity starts with "agent-" (LiveKit's
        // convention for dispatched agents) — we only need at least one
        // such participant to be present and connected.
        const agentIn = participants.some((p) =>
          (p.identity ?? "").toLowerCase().startsWith("agent-"),
        );
        if (agentIn) {
          agentReady = true;
          break;
        }
      } catch {
        // Transient list failures (race vs createRoom) — keep polling.
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!agentReady) {
      // Don't fatal the call — fall through to the SIP outbound anyway.
      // Worst case we degrade to the old "patient picks up then waits a
      // beat" behaviour rather than dropping the call entirely.
      console.warn(
        `[dialer] agent didn't enter room ${roomName} within ${warmupTimeoutMs}ms — proceeding with SIP outbound regardless`,
      );
    }

    // Now the room is warm — start the SIP outbound. Patient lands in a
    // room where the agent is already audio-active.
    participant = await sip.createSipParticipant(
      lk.trunk,
      toE164,
      roomName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sipOptions as any,
    );
  } catch (err) {
    await sb
      .from("calls")
      .update({ state: "failed", ended_at: new Date().toISOString(), duration_secs: 0 })
      .eq("id", callId);
    // Kill the room so the warm-dispatched agent doesn't sit idle for
    // 60 s waiting on its own watchdog — without this, every ring
    // timeout produced a 1:06 "PAS DE REPONSE" on the dashboard because
    // the agent kept the room alive until first_agent_turn expired and
    // its _stamp_end overwrote our 10 s ended_at with the watchdog
    // timestamp. deleteRoom is best-effort: a missing room (LK GC,
    // racey shutdown) is fine — we already wrote ended_at.
    try {
      const cleanupRooms = new RoomServiceClient(lk.host, lk.key, lk.secret);
      await cleanupRooms.deleteRoom(roomName);
    } catch (rmErr) {
      console.warn(
        `[dialer] deleteRoom ${roomName} failed after ring timeout: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
      );
    }
    throw err;
  }

  await sb
    .from("calls")
    .update({
      room_id: roomName,
      state: "answered",
      answered_at: new Date().toISOString(),
      metadata: {
        campaign_id: campaignId,
        target_id: targetId,
        livekit_participant_sid: participant.participantId ?? null,
      },
    })
    .eq("id", callId);

  await sb
    .from("campaign_targets")
    .update({
      status: "answered",
      payload: { via: "livekit", room: roomName, call_id: callId, dialed_at: new Date().toISOString() },
    })
    .eq("id", targetId);

  dlog("info", { ...ctx, call_id: callId }, `LiveKit originate ok → room=${roomName}`);
}

/**
 * Is a human agent ready to take a campaign call right now?
 *   (a) online + available — presence row status='available' with a fresh
 *       heartbeat (the softphone beats every ~25s; >90s ⇒ treat as gone).
 *   (b) not already on a call — checked in REAL TIME via the desk room: a
 *       `pstn-*` participant in `desk-<handleId>` means a lead is connected
 *       (ringing or talking), so the agent is busy. This is robust to a calls
 *       row that never got marked ended.
 */
async function humanAgentReady(
  sb: SupabaseClient,
  orgId: string,
  userId: string,
  handleId: string,
): Promise<boolean> {
  const { data: presence } = await sb
    .from("human_presence")
    .select("status,last_seen")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  const p = presence as { status?: string; last_seen?: string | null } | null;
  if (!p || p.status !== "available") return false;
  if (p.last_seen && Date.now() - new Date(p.last_seen).getTime() > 90_000) return false;

  const lkUrlRaw = process.env.LIVEKIT_URL;
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;
  if (lkUrlRaw && lkKey && lkSecret) {
    const host = lkUrlRaw.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    try {
      const rooms = new RoomServiceClient(host, lkKey, lkSecret);
      const parts = await rooms.listParticipants(`desk-${handleId}`);
      if (parts.some((pp) => (pp.identity ?? "").startsWith("pstn-"))) return false;
    } catch {
      // Room missing (agent not actually connected) — presence said available,
      // but with no desk room there's nobody to bridge to. Treat as not ready.
      return false;
    }
  }
  return true;
}

/**
 * Dial a lead and bridge the answered leg into a HUMAN agent's desk room.
 * No AI is dispatched: the human's softphone is already joined to
 * `desk-<handleId>` and is rung by its realtime calls subscription when the
 * calls row below appears. Mirrors /api/desk/dial's LiveKit SIP path.
 */
async function dialViaHumanDesk(args: {
  sb: SupabaseClient;
  ctx: LogCtx;
  orgId: string;
  handleId: string;
  campaignId: string;
  targetId: string;
  toE164: string;
  fromE164: string | null;
  lk: { trunk: string; host: string; key: string; secret: string };
}): Promise<void> {
  const { sb, ctx, orgId, handleId, campaignId, targetId, toE164, fromE164, lk } = args;
  const roomName = `desk-${handleId}`;

  const { data: call, error: callErr } = await sb
    .from("calls")
    .insert({
      org_id: orgId,
      direction: "out",
      state: "ringing",
      from_e164: fromE164,
      to_e164: toE164,
      agent_handle_id: handleId,
      room_id: roomName,
      metadata: { campaign_id: campaignId, target_id: targetId, via: "human_desk" },
    })
    .select()
    .single();
  if (callErr || !call) throw new Error(`calls insert failed: ${callErr?.message ?? "unknown"}`);
  const callId = call.id as string;
  try {
    await sb
      .from("campaign_targets")
      .update({ last_call_id: callId, last_attempt_at: new Date().toISOString() })
      .eq("id", targetId);
  } catch {
    /* non-fatal */
  }

  let participant: { participantId?: string } | undefined;
  try {
    const sip = new SipClient(lk.host, lk.key, lk.secret);
    const sipOptions = {
      participantIdentity: `pstn-${callId}`,
      participantName: toE164,
      participantAttributes: {
        "axon.call_id": callId,
        "axon.direction": "out",
        "axon.agent_handle_id": handleId,
        "axon.campaign_id": campaignId,
        "axon.target_id": targetId,
      },
      waitUntilAnswered: true,
      ringingTimeout: Math.max(5, Math.min(60, Number(process.env.HUMAN_DIAL_RING_TIMEOUT_SECS ?? 25))),
      fromNumber: fromE164 ?? undefined,
    };
    participant = await sip.createSipParticipant(
      lk.trunk,
      toE164,
      roomName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sipOptions as any,
    );
  } catch (err) {
    await sb
      .from("calls")
      .update({ state: "failed", ended_at: new Date().toISOString(), duration_secs: 0 })
      .eq("id", callId);
    throw err;
  }

  await sb
    .from("calls")
    .update({
      state: "answered",
      answered_at: new Date().toISOString(),
      metadata: { campaign_id: campaignId, target_id: targetId, via: "human_desk", livekit_participant_sid: participant.participantId ?? null },
    })
    .eq("id", callId);
  await sb
    .from("campaign_targets")
    .update({
      status: "answered",
      payload: { via: "human_desk", room: roomName, call_id: callId, dialed_at: new Date().toISOString() },
    })
    .eq("id", targetId);
  dlog("info", { ...ctx, call_id: callId }, `human-desk originate ok → room=${roomName}`);
}

/**
 * Dial a single campaign_target.
 *
 * Flow:
 *   1. Load target + campaign + contact + phone_number.
 *   2. Mark target 'dialing', bump attempts, set last_attempt_at.
 *   3. Place the Twilio call. TwiML URL points back to the Next.js app so the
 *      voice flow logic stays in one place. StatusCallback points back to
 *      /api/twilio/status with campaign_id + target_id so the campaign_targets
 *      state machine is driven from the same handler that drives calls.
 *   4. Save the resulting Twilio SID on the target's payload.
 */
export async function dialTarget(job: DialJob): Promise<void> {
  const sb = supabase();
  const ctx: LogCtx = { target_id: job.target_id, campaign_id: job.campaign_id };

  const { data: targetRaw, error: tErr } = await sb
    .from("campaign_targets")
    .select(
      "id,campaign_id,contact_id,status,attempts,payload,contacts(e164,display_name)",
    )
    .eq("id", job.target_id)
    .single();
  if (tErr || !targetRaw) {
    dlog("error", ctx, `target not found: ${tErr?.message ?? "unknown"}`);
    return;
  }
  const target: DialTargetRow = toDialTargetRow(
    targetRaw as Record<string, unknown>,
  );
  if (target.status !== "pending") {
    dlog("info", ctx, `target status=${target.status}, skipping`);
    return;
  }

  const { data: campaignRaw, error: cErr } = await sb
    .from("campaigns")
    .select(
      "id,org_id,state,phone_number_id,caller_id_e164,amd_enabled,max_attempts,retry_delay_min,agent_handle_id,metadata",
    )
    .eq("id", job.campaign_id)
    .single();
  if (cErr || !campaignRaw) {
    dlog("error", ctx, "campaign not found");
    return;
  }
  const campaign: DialCampaignRow = toDialCampaignRow(
    campaignRaw as Record<string, unknown>,
  );
  if (campaign.state !== "running") {
    dlog("info", ctx, `campaign state=${campaign.state}, skipping`);
    return;
  }

  // Resolve the underlying agents.id from the campaign's agent_handle.
  // agent_handles wraps both AI and human agents; for AI handles, ai_agent_id
  // points at agents.id which is what the LiveKit worker (agent/agent.py)
  // needs to load persona, voice, model, etc. Without this, the worker falls
  // back to env defaults and the user hears a generic voice instead of the
  // cloned voice they picked for the campaign.
  let aiAgentId: string | null = null;
  let handleKind: string | null = null;
  let handleUserId: string | null = null;
  const handleId = (campaignRaw as { agent_handle_id?: string | null })
    .agent_handle_id ?? null;
  if (handleId) {
    const { data: handle } = await sb
      .from("agent_handles")
      .select("kind,ai_agent_id,user_id")
      .eq("id", handleId)
      .single();
    const h = handle as { kind?: string; ai_agent_id?: string | null; user_id?: string | null } | null;
    handleKind = h?.kind ?? null;
    if (h?.kind === "ai" && h.ai_agent_id) {
      aiAgentId = h.ai_agent_id;
    } else if (h?.kind === "human" && h.user_id) {
      // Human-agent campaign: the answered call is bridged into this user's
      // desk room (their softphone), no AI dispatched. See Path C below.
      handleUserId = h.user_id;
    }
  }

  const contact = parseContact(target.contacts);
  const toE164: string | null = contact?.e164 ?? null;

  // Resolve the caller-id (E.164) to use as From.
  //   1. campaign.caller_id_e164         (explicit override)
  //   2. campaign.phone_number_id        (number pinned to the campaign)
  //   3. geo-routing on the destination  (org-owned number that matches toE164's
  //      country, falling back to org default, then any active number)
  let fromE164: string | null = campaign.caller_id_e164 ?? null;
  if (!fromE164 && campaign.phone_number_id) {
    const { data: pn } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("id", campaign.phone_number_id)
      .single();
    fromE164 = (pn as { e164?: string } | null)?.e164 ?? null;
  }
  if (!fromE164 && toE164 && campaign.org_id) {
    fromE164 = await pickFromNumberForOrg(sb, campaign.org_id, toE164);
  }
  if (!fromE164 || !toE164) {
    dlog("error", ctx, `missing from/to (from=${fromE164}, to=${toE164})`);
    await sb
      .from("campaign_targets")
      .update({ status: "failed", last_attempt_at: new Date().toISOString() })
      .eq("id", target.id);
    return;
  }

  // ─── Human-agent campaign gate ───────────────────────────────────────────
  // A campaign whose handle is a HUMAN bridges the answered lead into that
  // agent's desk room (their softphone). Only dial when the agent is online +
  // available AND not already on a call — otherwise a 2nd lead would land in
  // the same room. If not ready, defer the lead a couple minutes WITHOUT
  // burning an attempt or sending the pre-call message.
  if (handleKind === "human") {
    if (!handleUserId || !handleId) {
      dlog("error", ctx, "human handle missing user_id — failing target");
      await sb.from("campaign_targets")
        .update({ status: "failed", last_attempt_at: new Date().toISOString() })
        .eq("id", target.id);
      return;
    }
    const ready = await humanAgentReady(sb, campaign.org_id, handleUserId, handleId);
    if (!ready) {
      await sb.from("campaign_targets")
        .update({ status: "pending", next_attempt_at: new Date(Date.now() + 2 * 60_000).toISOString() })
        .eq("id", target.id);
      dlog("info", ctx, "human agent offline/busy — deferring lead 2 min");
      return;
    }
  }

  // ─── Pre-call message gate (campaign.metadata.precall_message) ───────────
  // When the campaign opts in, the patient gets a templated SMS *or* WhatsApp
  // ~lead_minutes before EACH dial attempt (so they recognise the incoming
  // call). We key the "already sent?" check on the UPCOMING attempt number:
  // payload.precall_sms_attempt === attempts+1 means the message for this very
  // attempt is already out, so fall through and dial. Otherwise we (atomically)
  // claim the row, defer it by lead_minutes, send the message, and return
  // WITHOUT dialing — the same target is re-picked ~lead_minutes later and
  // dials then. Because every real dial bumps `attempts`, the next attempt's
  // check fails again and re-sends — one message per call. No-op for every
  // campaign that doesn't configure it. `precall_message` is the new (channel-
  // aware) shape; `precall_sms` is kept as a legacy SMS-only fallback.
  const precall = campaign.metadata?.precall_message ?? campaign.metadata?.precall_sms;
  // Resolve the channel(s) to fire: the new multi-channel shape (precall.sms /
  // precall.whatsapp — either or both), or the legacy single-channel shape
  // (top-level content_sid, used by the existing precall_sms campaign).
  const precallTargets: { channel: "sms" | "whatsapp"; contentSid: string; from?: string }[] = [];
  if (precall?.enabled) {
    if (precall.sms?.content_sid) precallTargets.push({ channel: "sms", contentSid: precall.sms.content_sid, from: precall.sms.from });
    if (precall.whatsapp?.content_sid) precallTargets.push({ channel: "whatsapp", contentSid: precall.whatsapp.content_sid, from: precall.whatsapp.from });
    if (precallTargets.length === 0 && precall.content_sid) {
      precallTargets.push({ channel: precall.channel === "whatsapp" ? "whatsapp" : "sms", contentSid: precall.content_sid, from: precall.from });
    }
  }
  if (precallTargets.length > 0) {
    const upcoming = (target.attempts ?? 0) + 1;
    const payload = target.payload ?? {};
    const lastSmsAttempt = Number((payload as Record<string, unknown>).precall_sms_attempt ?? 0);
    // If a previous SMS attempt failed (e.g. STOP / unsubscribed / invalid number),
    // don't retry on future dial attempts — go straight to dialing.
    const prevSmsFailed = Boolean((payload as Record<string, unknown>).precall_sms_error);
    if (lastSmsAttempt !== upcoming && !prevSmsFailed) {
      const leadMin = Math.max(1, Math.min(15, Number(precall?.lead_minutes ?? 2)));
      const nextAt = new Date(Date.now() + leadMin * 60_000).toISOString();
      // Atomic claim: mark this attempt's message(s) as sent AND push
      // next_attempt_at out by lead_minutes, guarded on status='pending' so a
      // concurrent tick can't double-send. If we don't win the row, skip.
      const { data: claimed, error: claimErr } = await sb
        .from("campaign_targets")
        .update({
          next_attempt_at: nextAt,
          payload: { ...payload, precall_sms_attempt: upcoming, precall_sms_at: new Date().toISOString() },
        })
        .eq("id", target.id)
        .eq("status", "pending")
        .select("id");
      if (claimErr || !claimed || claimed.length === 0) {
        dlog("info", ctx, "precall: row not claimable (concurrent pick / not pending) — skipping");
        return;
      }
      const rawFirst = (contact?.display_name ?? "").trim().split(/\s+/)[0] || "";
      const firstName = rawFirst
        ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1)
        : "there";
      const leadName = (contact?.display_name ?? "").trim() || null;
      // Best-effort row in precall_sms_log per channel for the dashboard SMS tab.
      const logPrecall = async (channel: string, contentSid: string, twilioSid: string | null, status: string, error: string | null) => {
        try {
          await sb.from("precall_sms_log").insert({
            org_id: campaign.org_id,
            campaign_id: campaign.id,
            target_id: target.id,
            contact_id: target.contact_id,
            to_e164: toE164,
            lead_name: leadName,
            channel,
            content_sid: contentSid,
            twilio_sid: twilioSid,
            status,
            error,
            attempt: upcoming,
          });
        } catch (logErr) {
          dlog("warn", ctx, `precall log insert failed: ${logErr instanceof Error ? logErr.message : String(logErr)}`);
        }
      };
      // Send each enabled channel. WhatsApp goes through the same Twilio Content
      // API — only the To/From carry the `whatsapp:` prefix.
      let anySent = false;
      let lastErr = "";
      for (const ch of precallTargets) {
        const chFrom = ch.from || fromE164;
        const isWa = ch.channel === "whatsapp";
        try {
          const sms = await sendContentSms({
            to: isWa ? `whatsapp:${toE164}` : toE164,
            from: isWa ? `whatsapp:${chFrom}` : chFrom,
            contentSid: ch.contentSid,
            variables: { "1": firstName },
          });
          anySent = true;
          dlog("info", { ...ctx, call_id: sms.sid }, `precall-${ch.channel} sent to=${toE164} attempt=${upcoming} — dial in ~${leadMin}min`);
          await logPrecall(ch.channel, ch.contentSid, sms.sid ?? null, "sent", null);
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          dlog("warn", ctx, `precall-${ch.channel} send failed: ${lastErr}`);
          await logPrecall(ch.channel, ch.contentSid, null, "failed", lastErr);
        }
      }
      if (!anySent) {
        // The message couldn't be sent — most often the recipient replied STOP
        // (Twilio 21610 "unsubscribed") or the number is invalid/blocked. The
        // pre-call message is a BEST-EFFORT heads-up, NOT a prerequisite: a STOP
        // opt-out blocks SMS, not voice (call opt-outs are the DNC list's job,
        // enforced just below). So we do NOT loop re-sending it — we keep the
        // marker as "attempted for this dial" and let the lead be DIALED on the
        // next pick, promptly. (Previously we rolled the marker back and retried
        // every 60s, which flooded the log — 81× for one unsubscribed number —
        // and never placed the call.)
        await sb
          .from("campaign_targets")
          .update({
            next_attempt_at: new Date().toISOString(),
            payload: { ...payload, precall_sms_attempt: upcoming, precall_sms_error: lastErr },
          })
          .eq("id", target.id);
      }
      return; // dial happens on the next pick (with the message, or — if it
              // couldn't be sent — without it)
    }
  }

  // DNC enforcement — abort before bumping attempts so we don't burn through
  // retry budget on a phone number that legally must not be dialed.
  if (toE164 && (campaign as any).org_id) {
    const { data: dnc } = await sb
      .from("dnc_lists")
      .select("id, reason")
      .eq("org_id", (campaign as any).org_id as string)
      .eq("e164", toE164)
      .maybeSingle();
    if (dnc) {
      console.warn(
        `[dial] target=${target.id} blocked by DNC list (reason=${dnc.reason ?? "—"})`,
      );
      await sb
        .from("campaign_targets")
        .update({
          status: "failed",
          last_attempt_at: new Date().toISOString(),
          next_attempt_at: null,
          payload: {
            last_error: "dnc_blocked",
            dnc_reason: dnc.reason ?? null,
          },
        })
        .eq("id", target.id);
      return;
    }
  }

  // Optimistic update: mark dialing + bump attempts.
  const { error: uErr } = await sb
    .from("campaign_targets")
    .update({
      status: "dialing",
      attempts: (target.attempts ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: null,
    })
    .eq("id", target.id)
    .eq("status", "pending"); // optimistic lock
  if (uErr) {
    dlog("error", ctx, `failed to mark dialing: ${uErr.message}`);
    return;
  }

  // ─── Path selection ─────────────────────────────────────────────────────
  // Default: LiveKit-originated outbound (Path A). LiveKit sends the SIP
  // INVITE into the Twilio Elastic SIP Trunk, which routes to PSTN. Twilio
  // bills this as a single `Trunking Terminating` line at the SIP trunk rate,
  // not the double Phone+SIP that the createCall + TwiML <Dial><Sip> pattern
  // produced (Path B). The previous "silence on pickup" regression that kept
  // Path B as default was fixed by dispatching the agent in parallel with
  // `createSipParticipant` (see dialViaLiveKit above) — the agent warms up
  // during the ring instead of after pickup, so the patient gets the greeting
  // immediately. Force Path B with DIAL_PREFER_LIVEKIT_SIP=false.
  const preferLiveKitSip = (process.env.DIAL_PREFER_LIVEKIT_SIP ?? "true").toLowerCase() === "true";
  const lkTrunk = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID;
  const lkUrlRaw = process.env.LIVEKIT_URL;
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;

  // ─── Path C: human-agent campaign → bridge into the agent's desk room ────
  // No AI is dispatched. The answered PSTN leg lands in `desk-<handleId>`,
  // where the human's softphone is already joined (and gets rung via its
  // realtime calls subscription). Mirrors /api/desk/dial's LiveKit SIP path.
  if (handleKind === "human" && handleUserId && handleId && lkTrunk && lkUrlRaw && lkKey && lkSecret && toE164) {
    const lkHost = lkUrlRaw.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    try {
      await dialViaHumanDesk({
        sb, ctx, orgId: campaign.org_id, handleId,
        campaignId: campaign.id, targetId: target.id,
        toE164, fromE164,
        lk: { trunk: lkTrunk, host: lkHost, key: lkKey, secret: lkSecret },
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog("error", ctx, `human-desk originate failed: ${msg}`);
      const attemptsNow = (target.attempts ?? 0) + 1;
      const next = attemptsNow < (campaign.max_attempts ?? 3)
        ? new Date(Date.now() + (campaign.retry_delay_min ?? 60) * 60_000).toISOString()
        : null;
      await sb.from("campaign_targets")
        .update({ status: next ? "pending" : "failed", next_attempt_at: next, payload: { last_error: msg, via: "human_desk" } })
        .eq("id", target.id);
      return;
    }
  }

  if (preferLiveKitSip && lkTrunk && lkUrlRaw && lkKey && lkSecret && aiAgentId && toE164) {
    const lkHost = lkUrlRaw.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    try {
      await dialViaLiveKit({
        sb,
        ctx,
        orgId: campaign.org_id,
        campaignId: campaign.id,
        targetId: target.id,
        toE164,
        fromE164,
        aiAgentId,
        handleId,
        lk: { trunk: lkTrunk, host: lkHost, key: lkKey, secret: lkSecret },
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // NO Twilio fallback. The fallback re-dialed the SAME patient via
      // createCall the moment Path A errored — and "no answer within
      // ringingTimeout" IS an error on Path A, so every unanswered call
      // immediately rang the patient a second time through the Phone+SIP
      // double-billed path. Wati spotted the Phone rows reappearing in the
      // Twilio log within minutes of the June 10 go-live.
      // Instead: schedule a normal retry (same policy as the Twilio path's
      // failure handler) and stop. SIP-only, single attempt per slot.
      dlog("error", ctx, `LiveKit originate failed (no Twilio fallback): ${msg}`);
      // Slot-based campaigns: retry at the NEXT SLOT (one dial per lead per
      // slot), not now+retry_delay — which re-fired inside the window.
      const retry = computeRetry(new Date(), target, campaign);
      await sb
        .from("campaign_targets")
        .update({
          status: retry.status,
          next_attempt_at: retry.next_attempt_at,
          payload: { last_error: msg, via: "livekit" },
        })
        .eq("id", target.id);
      return;
    }
  }

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com";
  const base = appUrl.replace(/\/+$/, "");
  const twimlParams = new URLSearchParams({
    campaign_id: campaign.id,
    target_id: target.id,
    direction: "outbound",
  });
  if (aiAgentId) twimlParams.set("agent_id", aiAgentId);
  if (handleId) twimlParams.set("agent_handle_id", handleId);
  const twimlUrl = `${base}/api/twilio-voice?${twimlParams.toString()}`;
  const statusCallback = `${base}/api/twilio/status?campaign_id=${encodeURIComponent(campaign.id)}&target_id=${encodeURIComponent(target.id)}`;
  // Recording is on by default — operator review + dashboard playback. The
  // RecordingStatusCallback fires once Twilio finishes processing and gives
  // us the playable URL we store on calls.recording_url. Disable by setting
  // CALL_RECORDING_ENABLED=false on the dialer if a tenant opts out.
  const recordingEnabled = (process.env.CALL_RECORDING_ENABLED ?? "true").toLowerCase() !== "false";
  const recordingStatusCallback = recordingEnabled
    ? `${base}/api/twilio/recording-status?campaign_id=${encodeURIComponent(campaign.id)}&target_id=${encodeURIComponent(target.id)}`
    : undefined;

  try {
    const call = await createCall({
      to: toE164,
      from: fromE164,
      twimlUrl,
      statusCallback,
      amd: !!campaign.amd_enabled,
      // Per-tenant ring timeout. Default 5s — OCC ops want a fast cadence,
      // catching dead numbers immediately rather than waiting through 2-3
      // rings for a voicemail handoff. Override via DIAL_RING_TIMEOUT_SECS
      // without a redeploy. Twilio clamps 5-600s.
      timeout: Math.max(5, Math.min(600, Number(process.env.DIAL_RING_TIMEOUT_SECS ?? 10))),
      record: recordingEnabled,
      recordingStatusCallback,
    });
    await sb
      .from("campaign_targets")
      .update({
        payload: {
          twilio_call_sid: call.sid,
          twilio_status: call.status,
          dialed_at: new Date().toISOString(),
        },
      })
      .eq("id", target.id);
    // Annotate the call_id once we have the Twilio SID for cross-system tracing.
    const callCtx: LogCtx = { ...ctx, call_id: call.sid };
    dlog("info", callCtx, `dialed sid=${call.sid} status=${call.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTwilio = err instanceof TwilioError;
    dlog("error", ctx, `Twilio error: ${msg}`);

    // Failed before connecting — schedule a retry (next slot for slot-based
    // campaigns, else the classic attempts/retry_delay policy).
    const retry = computeRetry(new Date(), target, campaign);
    await sb
      .from("campaign_targets")
      .update({
        status: retry.status,
        next_attempt_at: retry.next_attempt_at,
        payload: { last_error: msg, twilio_status_code: isTwilio ? (err as TwilioError).code : null },
      })
      .eq("id", target.id);
  }
}
