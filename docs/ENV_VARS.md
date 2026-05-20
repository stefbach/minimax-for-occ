# Environment variables

Single source of truth for every `process.env.*` consumed by the three Axon
processes (Web / Agent / Dialer). Generated from a `grep` audit of the source
tree (see "Refresh" at the bottom).

Service column:

- **Web** = Next.js app (`web/`)
- **Agent** = LiveKit voice agent (`agent/`)
- **Dialer** = outbound BullMQ worker (`dialer/`)

> Required = process throws (or fails to do its job) if missing.
> Optional = a sensible fallback or feature flag is in place.

## Supabase

| Name                              | Service     | Req?      | Default | Where                                          |
|-----------------------------------|-------------|-----------|---------|------------------------------------------------|
| `SUPABASE_URL`                    | Web, Dialer | Required  | —       | Supabase Dashboard → Project Settings → API    |
| `SUPABASE_SERVICE_ROLE_KEY`       | Web, Dialer | Required  | —       | Supabase Dashboard → Project Settings → API    |
| `NEXT_PUBLIC_SUPABASE_URL`        | Web         | Optional  | —       | Same as `SUPABASE_URL` (exposed to the browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Web         | Optional  | —       | Supabase Dashboard → Project Settings → API    |

## OpenAI / LLM

| Name             | Service     | Req?     | Default | Where                                                     |
|------------------|-------------|----------|---------|-----------------------------------------------------------|
| `OPENAI_API_KEY` | Web, Agent  | Optional | —       | https://platform.openai.com/api-keys (for embeddings, summary, copilot) |

## MiniMax

| Name                | Service    | Req?     | Default                       | Where                                       |
|---------------------|------------|----------|-------------------------------|---------------------------------------------|
| `MINIMAX_API_KEY`   | Web, Agent | Optional | —                             | https://www.minimaxi.com/ → Account / Keys  |
| `MINIMAX_GROUP_ID`  | Web, Agent | Optional | —                             | MiniMax dashboard (some TTS endpoints need it) |
| `MINIMAX_BASE_URL`  | Web, Agent | Optional | `https://api.minimax.io/v1`   | Override only for a self-hosted proxy        |

## Twilio

| Name                 | Service | Req?     | Default | Where                                  |
|----------------------|---------|----------|---------|----------------------------------------|
| `TWILIO_ACCOUNT_SID` | Web, Dialer | Optional | — | Twilio Console → Account Info          |
| `TWILIO_AUTH_TOKEN`  | Web, Dialer | Optional | — | Twilio Console → Account Info          |

## LiveKit / SIP

| Name                     | Service | Req?     | Default | Where                                  |
|--------------------------|---------|----------|---------|----------------------------------------|
| `LIVEKIT_URL`            | Web, Agent | Required for voice | — | LiveKit Cloud Dashboard          |
| `LIVEKIT_API_KEY`        | Web, Agent | Required for voice | — | LiveKit Cloud Dashboard          |
| `LIVEKIT_API_SECRET`     | Web, Agent | Required for voice | — | LiveKit Cloud Dashboard          |
| `NEXT_PUBLIC_LIVEKIT_URL`| Web        | Optional | — | Same as `LIVEKIT_URL` for the browser SDK |
| `LIVEKIT_SIP_URI`        | Agent      | Optional | — | LiveKit SIP outbound trunk          |
| `LIVEKIT_SIP_USERNAME`   | Agent      | Optional | — | LiveKit SIP outbound trunk          |
| `LIVEKIT_SIP_PASSWORD`   | Agent      | Optional | — | LiveKit SIP outbound trunk          |

## Deepgram (STT, used by Agent)

| Name                 | Service | Req?     | Default | Where                                  |
|----------------------|---------|----------|---------|----------------------------------------|
| `DEEPGRAM_API_KEY`   | Agent   | Optional | —       | https://console.deepgram.com/          |

## n8n (workflow integration)

| Name                    | Service | Req?     | Default | Where                              |
|-------------------------|---------|----------|---------|------------------------------------|
| `N8N_BASE_URL`          | Web     | Optional | —       | Your n8n instance URL              |
| `N8N_API_KEY`           | Web     | Optional | —       | n8n → Settings → API               |
| `N8N_JWT_SECRET`        | Web     | Optional | —       | Shared HMAC secret for webhooks    |
| `N8N_WEBHOOK_BASE_URL`  | Web     | Optional | —       | Public URL of the n8n webhooks     |

## Stripe (billing)

| Name                    | Service | Req?     | Default | Where                                  |
|-------------------------|---------|----------|---------|----------------------------------------|
| `STRIPE_SECRET_KEY`     | Web     | Optional | —       | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Web     | Optional | —       | Stripe Dashboard → Webhooks            |
| `STRIPE_SUCCESS_URL`    | Web     | Optional | derived from `APP_URL` | n/a — config only |
| `STRIPE_CANCEL_URL`     | Web     | Optional | derived from `APP_URL` | n/a — config only |

## App URL / runtime

| Name                  | Service | Req?     | Default | Where                                  |
|-----------------------|---------|----------|---------|----------------------------------------|
| `APP_URL`             | Web, Dialer | Optional | — | Public origin of the deployed Next.js app |
| `NEXT_PUBLIC_APP_URL` | Web     | Optional | —     | Same as `APP_URL`, exposed to the browser |
| `APP_SHARED_TOKEN`    | Web, Agent | Optional | — | Shared HMAC used by Agent → Web callbacks |
| `VERCEL_URL`          | Web     | Optional | provided by Vercel | n/a (auto)               |
| `NODE_ENV`            | Web, Agent, Dialer | Optional | `development` | n/a (set by runtime) |

## Dialer worker

| Name                  | Service | Req?     | Default       | Where                                  |
|-----------------------|---------|----------|---------------|----------------------------------------|
| `REDIS_URL`           | Dialer  | Required | —             | Upstash / Fly Redis / self-hosted Redis URL (`redis://...`) |
| `POLL_INTERVAL_MS`    | Dialer  | Optional | `30000`       | tune scheduler tick frequency          |
| `WORKER_CONCURRENCY`  | Dialer  | Optional | `10`          | number of concurrent Twilio dials      |

## Rate limits / book helpers (Web)

| Name                                | Service | Req?     | Default | Where                          |
|-------------------------------------|---------|----------|---------|--------------------------------|
| `HANDOFF_RATE_LIMIT_PER_MINUTE`     | Web     | Optional | builtin | n/a — knob only                |
| `TOKEN_RATE_LIMIT_PER_MINUTE`       | Web     | Optional | builtin | n/a — knob only                |
| `AXON_USER_GUIDE_PATH`              | Web     | Optional | repo path | dev only — override doc path |
| `AXON_HOW_IT_WORKS_PATH`            | Web     | Optional | repo path | dev only                     |
| `AXON_PERSONAS_PATH`                | Web     | Optional | repo path | dev only                     |

## Refresh

To rebuild the list above, run from the repo root:

```bash
grep -rho 'process\.env\.[A-Z_][A-Z0-9_]*' \
  web/lib web/app web/components web/middleware.ts agent/ dialer/src \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  | sort -u
```

Then update this file. Centralised access lives in `web/lib/config.ts`.
