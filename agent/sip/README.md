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

### Option A — LiveKit outbound SIP API (implemented; activate via env var)

`/api/desk/dial` already supports this path. When the env var
`LIVEKIT_SIP_OUTBOUND_TRUNK_ID` is set, the endpoint calls
`SipClient.createSipParticipant` instead of Twilio's REST `Calls.json` —
LiveKit then dials Twilio (via the configured outbound trunk), Twilio
dials the PSTN destination, and the answered leg is bridged directly
into `desk-<handle>` (the room you specify in the API call). The human
can actually talk through their softphone.

Twilio is still the PSTN gateway and bills the minutes — only the
orchestration changes (Vercel → LiveKit → Twilio, instead of Vercel →
Twilio → … → LiveKit).

If `LIVEKIT_SIP_OUTBOUND_TRUNK_ID` is absent, `/desk/dial` falls back to
the legacy Twilio REST + TwiML path — useful for the "IA calls this
number" use case where you don't need the human in the loop.

#### One-time setup

**1. Twilio side** — make your Elastic SIP Trunk accept INVITEs from LiveKit.

Twilio Console → Elastic SIP Trunking → your trunk → *Termination*:
- Note the **Termination URI** (something like `your-trunk.pstn.twilio.com`).
- Under *Authentication*: either whitelist LiveKit's egress IPs (in the
  trunk's Access Control Lists) or create a Credential List and remember
  the username/password.

**2. LiveKit side** — create the outbound trunk.

Edit `agent/sip/outbound-trunk.json`:
- `address` ← the Twilio Termination URI (no `sip:` prefix needed).
- `auth_username` / `auth_password` ← credentials from step 1 (or remove
  both fields if you whitelisted IPs).
- `numbers` ← optional list of caller-id E.164s you want to allow on
  this trunk. Empty list = LiveKit picks whatever `sipNumber` you pass
  in `createSipParticipant` (the code already passes the geo-routed
  From number).

```bash
lk cloud auth
lk sip outbound-trunk create outbound-trunk.json
# -> note the returned trunk_id (starts with ST_)
```

**3. Wire it into the app**

Add to `web/.env.production` (or Vercel dashboard):
```
LIVEKIT_SIP_OUTBOUND_TRUNK_ID=ST_xxxxxxxxxxxx
```

Push / redeploy. Open `/settings` — the new `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`
entry under "LiveKit" should now read **défini**. Click **Appeler** in
`/desk` → the destination's phone rings → you answer → you actually hear
each other through the softphone. ✅

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
