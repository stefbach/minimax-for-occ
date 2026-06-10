import type { SupabaseClient } from "@supabase/supabase-js";
import { SipClient, RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";
import { supabase } from "./supabase.js";
import { createCall, TwilioError } from "./twilio.js";
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
      // 25s default (industry standard). The earlier 5s default killed the
      // June 10 go-live wave: humans need 10-15s median to physically reach
      // their phone, so 2/3 of calls "failed" before anyone could answer —
      // only early-answer carriers (Three's in-band ringback) survived the
      // cutoff. The "hang up fast when nobody's there" requirement is
      // handled POST-answer by the agent (speech-wait timeout + 4s idle
      // watchdog), not by chopping the ring.
      ringingTimeout: Math.max(5, Math.min(600, Number(process.env.DIAL_RING_TIMEOUT_SECS ?? 25))),
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
    const agentName = process.env.LIVEKIT_AGENT_NAME ?? "minimax-voice-agent";
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
      .update({ state: "failed", ended_at: new Date().toISOString() })
      .eq("id", callId);
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
      "id,campaign_id,contact_id,status,attempts,contacts(e164,display_name)",
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
      "id,org_id,state,phone_number_id,caller_id_e164,amd_enabled,max_attempts,retry_delay_min,agent_handle_id",
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
  const handleId = (campaignRaw as { agent_handle_id?: string | null })
    .agent_handle_id ?? null;
  if (handleId) {
    const { data: handle } = await sb
      .from("agent_handles")
      .select("kind,ai_agent_id")
      .eq("id", handleId)
      .single();
    const h = handle as { kind?: string; ai_agent_id?: string | null } | null;
    if (h?.kind === "ai" && h.ai_agent_id) {
      aiAgentId = h.ai_agent_id;
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
      const attemptsNow = (target.attempts ?? 0) + 1;
      const next =
        attemptsNow < (campaign.max_attempts ?? 3)
          ? new Date(Date.now() + (campaign.retry_delay_min ?? 60) * 60_000).toISOString()
          : null;
      await sb
        .from("campaign_targets")
        .update({
          status: next ? "pending" : "failed",
          next_attempt_at: next,
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
      timeout: Math.max(5, Math.min(600, Number(process.env.DIAL_RING_TIMEOUT_SECS ?? 25))),
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

    // Failed before connecting — schedule a retry if we still have attempts.
    const attemptsNow = (target.attempts ?? 0) + 1;
    const next =
      attemptsNow < (campaign.max_attempts ?? 3)
        ? new Date(Date.now() + (campaign.retry_delay_min ?? 60) * 60_000).toISOString()
        : null;
    await sb
      .from("campaign_targets")
      .update({
        status: next ? "pending" : "failed",
        next_attempt_at: next,
        payload: { last_error: msg, twilio_status_code: isTwilio ? (err as TwilioError).code : null },
      })
      .eq("id", target.id);
  }
}
