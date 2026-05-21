# Telephony — Twilio → LiveKit SIP → MiniMax agent

The agent in `../agent.py` works as-is for phone calls. You only need to wire
SIP plumbing once.

## 1. Twilio side

Two ways:

**(a) Direct SIP trunk (recommended for pure-inbound, no Vercel hop):**
- Create an Elastic SIP Trunk in Twilio.
- Origination → SIP URI: `sip:<your-project>.sip.livekit.cloud`
- Assign your phone number to the trunk.

**(b) Webhook → TwiML (uses the Next.js app):**
- On the phone number's *Voice* config, set the webhook to
  `https://<your-app>.vercel.app/api/twilio-voice` (HTTP POST).
- Set env vars on Vercel (or in `web/.env.production`):
  - `LIVEKIT_SIP_URI=sip:<your-project>.sip.livekit.cloud`
  - `LIVEKIT_SIP_USERNAME` / `LIVEKIT_SIP_PASSWORD` (optional, if your trunk requires auth)

Path (b) is also used by `/api/desk/dial` for outbound softphone calls.
The TwimlUrl carries `?room=desk-<handle>&call_id=<uuid>&direction=out`,
which `/api/twilio-voice` forwards onto the SIP INVITE as custom headers:

| Twilio query param | SIP header relayed to LiveKit |
|---|---|
| `room=desk-<handle>` | `X-LK-Room` |
| `call_id=<uuid>` | `X-LK-Call-Id` |
| `direction=out` | `X-LK-Direction` |
| `agent_handle_id=<uuid>` | `X-LK-Agent-Handle-Id` |

## 2. LiveKit side

```bash
# Install: https://docs.livekit.io/home/cli/cli-setup/
lk cloud auth

# Edit numbers + auth, then create the trunk:
lk sip inbound-trunk create inbound-trunk.json
# -> note the returned trunk_id, paste it into dispatch-rule.json

lk sip dispatch-rule create dispatch-rule.json
```

The dispatch rule's `attributes` map copies the forwarded SIP headers
onto each participant joining via SIP:

| SIP header | Participant attribute |
|---|---|
| `X-LK-Room` | `axon.room_hint` |
| `X-LK-Call-Id` | `axon.call_id` |
| `X-LK-Agent-Handle-Id` | `axon.agent_handle_id` |
| `X-LK-Direction` | `axon.direction` |

These attributes are visible to `agent.py` via the participant attributes
API — useful for logging, call disposition, and picking the right persona.

> Already created the dispatch rule with the older config?
> Update it in place: `lk sip dispatch-rule update <RULE_ID> dispatch-rule.json`

## 3. Routing outbound `/desk/dial` calls into the agent's softphone room

`dispatchRuleIndividual` creates a fresh `tel-<uuid>` room for every SIP
call, so a human who clicked **Appeler** in `/desk` ends up in a different
room from the PSTN leg — they hear the AI persona that auto-joins the
`tel-*` room, but they can't talk to the destination through their own
softphone.

The `X-LK-Room` header forwarded by `/api/twilio-voice` lands as the
participant attribute `axon.room_hint`, but it does **not** by itself
change which room LiveKit chose for the call — that decision was made
by the dispatch rule before the participant was created.

Two clean ways to close this gap:

### Option A — Refactor `/api/desk/dial` to use LiveKit's outbound SIP API (preferred)

Replace the Twilio REST `Calls.json` originate + TwiML-callback pattern
with a single call to LiveKit's `SipClient.createSipParticipant`:

```ts
import { SipClient } from "livekit-server-sdk";

const sip = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

await sip.createSipParticipant(
  process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID!,
  to_e164,
  `desk-${handle.id}`,         // ← target room, naturally the human's
  {
    participantIdentity: `pstn-${call.id}`,
    participantName: to_e164,
    participantAttributes: { call_id: call.id, direction: "out" },
  },
);
```

LiveKit then dials Twilio (via the configured outbound trunk) and bridges
the answered PSTN leg into the room you specified — the human's existing
softphone room. No dispatch rule juggling.

Required one-time setup:
```bash
# Configure an outbound trunk on LiveKit pointing at your Twilio Elastic
# SIP Trunk. Twilio must be set up to accept SIP INVITEs from LiveKit
# (Origination IP whitelist or trunk credentials).
lk sip outbound-trunk create outbound-trunk.json
# -> set LIVEKIT_SIP_OUTBOUND_TRUNK_ID in env (or web/.env.production)
```

This deprecates the Twilio REST + TwiML callback path for `/desk/dial`.
Inbound calls still go through Twilio → `/api/twilio-voice` → LiveKit SIP.

### Option B — Per-agent static dispatch rules

Create one `dispatchRuleDirect` per agent_handle, mapping its trunk-side
authentication to `roomName = desk-<handle>`. Impractical at scale (every
new human user needs a dispatch rule), but works for a one-off test of
the softphone flow without writing new code.

```json
{
  "name": "desk-2e13bc57",
  "trunk_ids": ["<INBOUND_TRUNK_ID>"],
  "rule": {
    "dispatchRuleDirect": { "roomName": "desk-2e13bc57-4e1c-44a8-a5e0-fc1df76fa72f" }
  },
  "inbound_numbers": ["+447700162160"]
}
```

## 4. Agent side

Nothing to change. The dispatch rule sets `agentName: "minimax-voice-agent"`,
which matches `WorkerOptions(agent_name="minimax-voice-agent")` — currently
the default identity used by `agents.cli.run_app`. If you customize, update
both sides to match.

## Test

Call your Twilio number → Twilio bridges to LiveKit → LiveKit creates a
`tel-<callsid>` room → the worker joins → conversation is in voice with
Deepgram STT + MiniMax-M2 LLM + MiniMax TTS.

For outbound `/desk/dial` calls: today they land in a `tel-*` room and
the human can't talk through their softphone. Apply Option A above (the
outbound SIP API refactor) to fix this — that's the canonical pattern
for browser-originated outbound voice in LiveKit.
