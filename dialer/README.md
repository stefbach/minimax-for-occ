# axon-dialer

Outbound dialer worker for Axon campaigns.

- **Scheduler**: polls Supabase every 30s for `campaigns` in `state='running'`
  whose schedule window is open, and enqueues `campaign_targets` whose
  `next_attempt_at <= now()` onto the `dial-queue` BullMQ queue. Respects
  per-campaign `max_concurrency`.
- **Worker**: pulls jobs off `dial-queue` and calls Twilio `/Calls` for each
  target. Updates the target row to `status='dialing'` and stores the Twilio
  call SID under `payload.twilio_call_sid`.

The TwiML URL points back at the Next.js app
(`{APP_URL}/api/twilio-voice?campaign_id=…&target_id=…`), keeping all voice
flow logic in one place.

## Run locally

```bash
cd dialer
npm install
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
TWILIO_ACCOUNT_SID=... \
TWILIO_AUTH_TOKEN=... \
REDIS_URL=redis://localhost:6379 \
APP_URL=https://your-app.vercel.app \
npm run dev
```

## Env vars

| Var | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key (worker bypasses RLS). |
| `TWILIO_ACCOUNT_SID` | yes | Twilio account SID (`AC…`). |
| `TWILIO_AUTH_TOKEN` | yes | Twilio auth token. |
| `REDIS_URL` | yes | BullMQ backing store. Upstash / Redis Cloud both work. |
| `APP_URL` | yes | Public base URL of the Next.js app (no trailing slash). |
| `POLL_INTERVAL_MS` | no | Scheduler poll interval, default `30000`. |
| `WORKER_CONCURRENCY` | no | Parallel BullMQ workers, default `10`. |

## Deploy

### Fly.io

```bash
fly launch --no-deploy --name axon-dialer --region cdg
fly secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  TWILIO_ACCOUNT_SID=... \
  TWILIO_AUTH_TOKEN=... \
  REDIS_URL=... \
  APP_URL=https://your-app.vercel.app
fly deploy
```

Example `fly.toml`:

```toml
app = "axon-dialer"
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"

[[services]]
  # No HTTP service — this is a pure worker.
  protocol = "tcp"
  internal_port = 0

[processes]
  worker = "node dist/main.js"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory = "512mb"
```

### Railway

1. New project → Deploy from GitHub repo, set root directory to `dialer/`.
2. Add the env vars from the table above (Railway picks up the `Dockerfile`).
3. Provision a Redis plugin and copy its `REDIS_URL` into the worker service.
4. Disable HTTP networking on the service — it's a worker only.

## Completion webhook (TODO)

The dialer kicks off calls but doesn't currently handle the Twilio
`StatusCallback` payload. Implement `web/app/api/twilio-voice/campaign-status/route.ts`
to translate Twilio call statuses (`completed`, `no-answer`, `busy`, `failed`,
plus the AMD result) back into `campaign_targets.status`. See the `TODO`
comment in `src/dial.ts`.
