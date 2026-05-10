# Telephony — Twilio → LiveKit SIP → MiniMax agent

The agent in `../agent.py` works as-is for phone calls. You only need to wire
SIP plumbing once.

## 1. Twilio side

Two ways:

**(a) Direct SIP trunk (recommended, no Vercel hop):**
- Create an Elastic SIP Trunk in Twilio.
- Origination → SIP URI: `sip:<your-project>.sip.livekit.cloud`
- Assign your phone number to the trunk.

**(b) Webhook → TwiML (uses the Next.js app):**
- On the phone number's *Voice* config, set the webhook to
  `https://<your-app>.vercel.app/api/twilio-voice` (HTTP POST).
- Set env vars on Vercel:
  - `LIVEKIT_SIP_URI=sip:<your-project>.sip.livekit.cloud`
  - `LIVEKIT_SIP_USERNAME` / `LIVEKIT_SIP_PASSWORD` (optional, if your trunk requires auth)

## 2. LiveKit side

```bash
# Install: https://docs.livekit.io/home/cli/cli-setup/
lk cloud auth

# Edit numbers + auth, then create the trunk:
lk sip inbound-trunk create inbound-trunk.json
# -> note the returned trunk_id, paste it into dispatch-rule.json

lk sip dispatch-rule create dispatch-rule.json
```

## 3. Agent side

Nothing to change. The dispatch rule sets `agentName: "minimax-voice-agent"`,
which matches `WorkerOptions(agent_name="minimax-voice-agent")` — currently
the default identity used by `agents.cli.run_app`. If you customize, update
both sides to match.

## Test

Call your Twilio number → Twilio bridges to LiveKit → LiveKit creates a
`tel-<callsid>` room → the worker joins → conversation is in voice with
Deepgram STT + MiniMax-M2 LLM + MiniMax TTS.
