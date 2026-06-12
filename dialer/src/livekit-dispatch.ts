import { SipClient } from "livekit-server-sdk";
import {
  RoomConfiguration,
  RoomAgentDispatch,
  type SIPDispatchRuleInfo,
  type SIPInboundTrunkInfo,
} from "@livekit/protocol";

/**
 * On dialer startup, make sure the inbound SIP dispatch rule auto-dispatches
 * our `minimax-voice-agent` worker as soon as a Twilio→LK SIP call lands.
 *
 * Why this exists:
 *   Path B (Twilio createCall → TwiML <Dial><Sip>) hands the call off to
 *   LiveKit, which creates a `tel-<callsid>` room via the dispatch rule but
 *   does NOT automatically run an agent unless the rule's `room_config.agents`
 *   field is populated. Our worker registers with agent_name set, so it only
 *   responds to explicit dispatch — and with nothing in room_config, the room
 *   sat empty for 1-5 seconds while the various agent providers raced to
 *   notice. During that gap, Twilio filled the patient's audio with its
 *   default UK ringback tone. The fix: set room_config.agents = [
 *   {agent_name: "minimax-voice-agent"}] so LK Cloud dispatches the agent
 *   the moment the SIP participant joins the room.
 *
 * This helper is idempotent — if the rule already has the right agent
 * configured, it logs and returns; otherwise it patches the rule in place.
 * Runs on every dialer boot so a fresh Fly machine self-heals if someone
 * edits the rule out of band.
 */
// Rotation du 12/06/2026 : voir agent/agent.py (_AGENT_NAME) — file de
// dispatch LiveKit corrompue pour l'ancien nom "minimax-voice-agent".
const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME ?? "axon-voice-agent";
const RULE_NAME_HINT = "twilio-to-axon"; // matches agent/sip/dispatch-rule.json

export async function ensureInboundDispatchRuleAgent(): Promise<void> {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    console.log("[livekit-dispatch] skipped — LIVEKIT env not fully set");
    return;
  }
  const host = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  const sip = new SipClient(host, key, secret);

  let rules: SIPDispatchRuleInfo[];
  try {
    rules = await sip.listSipDispatchRule();
  } catch (e) {
    console.error("[livekit-dispatch] list dispatch rules failed:", (e as Error).message);
    return;
  }
  if (!rules || rules.length === 0) {
    console.warn("[livekit-dispatch] no dispatch rules found — nothing to update");
    return;
  }

  // Pick the inbound rule we care about: prefer the one whose name matches our
  // canonical `twilio-to-axon`, else fall back to the first rule (most tenants
  // only have one — keeps this from no-oping just because the operator renamed it).
  const target =
    rules.find((r) => r.name === RULE_NAME_HINT) ?? rules[0];
  const ruleId = target.sipDispatchRuleId;
  if (!ruleId) {
    console.warn("[livekit-dispatch] target rule has no id, skipping");
    return;
  }

  const existing = target.roomConfig?.agents ?? [];
  const alreadyConfigured = existing.some((a) => a?.agentName === AGENT_NAME);
  if (alreadyConfigured) {
    console.log(
      `[livekit-dispatch] rule ${ruleId} (${target.name}) already auto-dispatches ${AGENT_NAME} — no change`,
    );
    return;
  }

  // Build a new room_config that preserves any existing settings and just
  // injects our agent. RoomConfiguration is empty-tolerant on every field.
  const nextRoomConfig = new RoomConfiguration({
    ...(target.roomConfig ?? {}),
    agents: [
      ...(target.roomConfig?.agents ?? []),
      new RoomAgentDispatch({ agentName: AGENT_NAME }),
    ],
  });

  // updateSipDispatchRule(id, info) accepts the FULL info object; we mutate
  // the field we care about and round-trip everything else.
  target.roomConfig = nextRoomConfig;
  try {
    await sip.updateSipDispatchRule(ruleId, target);
    console.log(
      `[livekit-dispatch] patched rule ${ruleId} (${target.name}) — agents=[${AGENT_NAME}]`,
    );
  } catch (e) {
    console.error(`[livekit-dispatch] updateSipDispatchRule(${ruleId}) failed:`, (e as Error).message);
  }
}

/**
 * On dialer startup, make sure Krisp noise cancellation is enabled on the
 * inbound SIP trunk. Krisp lives at the trunk level on LK Cloud — when on,
 * inbound audio is filtered to suppress background noise (TV, kids,
 * traffic, etc.) before it reaches the agent's STT pipeline. This handles
 * OCC's Scenario 2 (background noise) and improves the signal-to-noise
 * for Scenarios 3 (accents) and 5 (multiple voices) too.
 *
 * Idempotent: skips when already enabled; flips the bit otherwise.
 */
const INBOUND_TRUNK_NAME_HINT = "twilio-inbound"; // matches agent/sip/inbound-trunk.json

export async function ensureInboundTrunkKrisp(): Promise<void> {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    console.log("[livekit-trunk-krisp] skipped — LIVEKIT env not fully set");
    return;
  }
  const host = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  const sip = new SipClient(host, key, secret);

  let trunks: SIPInboundTrunkInfo[];
  try {
    trunks = await sip.listSipInboundTrunk();
  } catch (e) {
    console.error("[livekit-trunk-krisp] list inbound trunks failed:", (e as Error).message);
    return;
  }
  if (!trunks || trunks.length === 0) {
    console.warn("[livekit-trunk-krisp] no inbound trunks found — nothing to update");
    return;
  }

  const target =
    trunks.find((t) => t.name === INBOUND_TRUNK_NAME_HINT) ?? trunks[0];
  const trunkId = target.sipTrunkId;
  if (!trunkId) {
    console.warn("[livekit-trunk-krisp] target trunk has no id, skipping");
    return;
  }

  if (target.krispEnabled) {
    console.log(
      `[livekit-trunk-krisp] trunk ${trunkId} (${target.name}) already has krispEnabled=true — no change`,
    );
    return;
  }

  // Round-trip the full info object — there's no `krispEnabled` field on
  // updateSipInboundTrunkFields, so we use the full updateSipInboundTrunk
  // path and mutate the bit in place.
  target.krispEnabled = true;
  try {
    await sip.updateSipInboundTrunk(trunkId, target);
    console.log(
      `[livekit-trunk-krisp] enabled Krisp on inbound trunk ${trunkId} (${target.name})`,
    );
  } catch (e) {
    console.error(
      `[livekit-trunk-krisp] updateSipInboundTrunk(${trunkId}) failed:`,
      (e as Error).message,
    );
  }
}
