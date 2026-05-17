# Axon — Telephony & Twilio webhooks

This document covers the outbound campaign lifecycle: how Twilio
StatusCallbacks drive `campaign_targets.status` and how call recordings
land in Supabase Storage.

## 1. One-time setup

### 1.1 Supabase Storage bucket

Recordings are uploaded to a **private** bucket. Buckets cannot be
reliably created via SQL (see `supabase/migrations/0011_storage_bucket_note.sql`),
so create it manually:

1. Supabase Dashboard → **Storage** → **New bucket**.
   - Name: `axon-recordings`
   - Public: **No** (keep private — we hand out 7-day signed URLs).
2. **Policies** tab → leave defaults. The `service_role` already has full
   access on every bucket, which is what the webhook uses.

### 1.2 Environment variables

Already required for the rest of the platform; double-check they are set
on Vercel (and locally in `.env.local`):

| Var | Why |
|---|---|
| `TWILIO_ACCOUNT_SID` | Basic-auth user for fetching recordings + REST API. |
| `TWILIO_AUTH_TOKEN`  | Basic-auth password. |
| `SUPABASE_URL` | Server client used by both webhooks. |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS for inserts. |
| `NEXT_PUBLIC_APP_URL` (or `VERCEL_URL`) | Used by the dialer to build callback URLs. |

## 2. Twilio webhook URLs to register

`{APP_URL}` is your Vercel deployment, e.g. `https://axon.vercel.app`.

### 2.1 Per outbound call (set automatically by the dialer)

The dialer worker (`dialer/src/dial.ts`) already attaches a
StatusCallback URL when it places each call:

```
{APP_URL}/api/twilio/status?campaign_id=<uuid>&target_id=<uuid>
```

Subscribed events: `initiated`, `ringing`, `answered`, `completed`.
The dialer code currently points at
`{APP_URL}/api/twilio-voice/campaign-status` — **update it (or alias
that route) so the dialer's `statusCallback` lands at
`/api/twilio/status` instead**. The dialer source is owned by the
dialer agent, so do not edit it from this branch; coordinate the
rename / alias separately.

### 2.2 Per Twilio number (Voice config)

Twilio Console → **Phone Numbers → Active numbers → \<your number\>**:

| Field | Value |
|---|---|
| A call comes in (Voice) | `{APP_URL}/api/twilio-voice` (unchanged TwiML route) |
| Call status changes | `{APP_URL}/api/twilio/status` (POST) |

The "Call status changes" callback covers inbound calls and gives us
the same lifecycle data for non-campaign traffic.

### 2.3 Recording status callback

When you start a recording (via TwiML `<Record recordingStatusCallback="…">`
or via the REST API `RecordingStatusCallback` parameter), point it at:

```
{APP_URL}/api/twilio/recording   (HTTP POST)
```

The route downloads the `.mp3`, uploads it to
`axon-recordings/calls/<call_id>.mp3`, patches `public.calls.recording_url`
with a 7-day signed URL, and appends a `recording_saved` row to
`public.call_events`.

## 3. Campaign target state machine

The `/api/twilio/status` route maps Twilio's `CallStatus` + `AnsweredBy`
to `campaign_targets.status`:

| Twilio CallStatus | AnsweredBy | Resulting status | Side effect |
|---|---|---|---|
| `completed` | `machine_start` | `no_answer` | attempts++ |
| `completed` | `human` (or unset) | `done` | attempts++ |
| `busy` | — | `busy` (terminal) **or** `pending` with `next_attempt_at = now() + campaign.retry_delay_min` if `attempts < max_attempts` | attempts++ |
| `no-answer` | — | `no_answer` (terminal) **or** `pending` with retry | attempts++ |
| `failed` / `canceled` | — | `failed` | attempts++ |
| `initiated` / `ringing` / `in-progress` | — | unchanged | `last_call_id` updated |

Every status callback appends a `call_events { kind: 'twilio_status' }`
row carrying the full Twilio payload, so audit trails are preserved.

## 4. Files

| Path | Purpose |
|---|---|
| `web/app/api/twilio/status/route.ts` | Lifecycle webhook. |
| `web/app/api/twilio/recording/route.ts` | Recording → Supabase Storage. |
| `web/lib/storage.ts` | `uploadRecording` + `downloadTwilioRecording`. |
| `supabase/migrations/0011_storage_bucket_note.sql` | Documents the manual bucket step. |
