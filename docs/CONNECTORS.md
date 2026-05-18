# Inbound lead connectors (n8n → Axon)

Axon receives external leads through a single signed endpoint:

```
POST {AXON_URL}/api/leads/inbound
Content-Type: application/json

{
  "secret":     "...",               // required, one secret per connector
  "e164":       "+33612345678",      // required, E.164 phone
  "first_name": "Jane",
  "last_name":  "Doe",
  "name":       "Jane Doe",
  "email":      "jane@example.com",
  "source":     "google_ads",        // google_ads | facebook_ads | csv | n8n
  "metadata":   { "lead_created_at": "2026-05-18T12:34:56Z", "...": "..." },
  "campaign_id": null                // optional override
}
```

Behaviour:

- The `secret` resolves to an org (and optionally a default `campaign_id`)
  via the `inbound_webhook_secrets` table.
- If no `campaign_id` is provided in the body or in the secret row, Axon
  picks the most recent campaign in state `running`, `scheduled` or
  `draft` for that org.
- The contact is upserted by `(org_id, e164)`.
- A `campaign_targets` row is created (or refreshed) with:
  - `source` = the `source` field from the body
  - `source_metadata` = the `metadata` field from the body
  - `priority` = **0** if `now() - metadata.lead_created_at` is below
    `campaigns.speed_to_lead_secs` (default 60s) — top of the dialer queue.
    Otherwise `5` (normal).
  - `status` = `pending`, `next_attempt_at` = `now()`.

Response: `201 { target_id, campaign_id, contact_id, priority, lead_age_secs, speed_to_lead_secs }`.

## 1. Generate a webhook secret

1. Open **Administration → Connecteurs entrants** in Axon.
2. Click **Générer secret**, give it a name (e.g. "Google Ads – Septembre")
   and optionally pin it to a specific campaign.
3. Copy the **URL** and the **secret**.

The same URL is used for every connector — only the secret changes.

## 2. Import an n8n template

In n8n: **Workflows → "+" → Import from File**, then pick one of:

- `n8n/templates/google-ads-lead-to-axon.json`
- `n8n/templates/facebook-lead-ads-to-axon.json`
- `n8n/templates/google-sheets-to-axon.json`

After import, set the following **n8n environment variables**
(Settings → Environment variables, or via your n8n host):

| Variable               | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `AXON_URL`             | Base URL of your Axon deployment, e.g. `https://app.axon.fr` |
| `AXON_INBOUND_SECRET`  | The secret from step 1 (one per connector)                  |
| `FB_VERIFY_TOKEN`      | (Facebook only) the verify token you give to Meta            |
| `AXON_SHEET_ID`        | (Google Sheets only) the spreadsheet ID                      |

Then **activate** the workflow.

### Google Ads Lead Form Extensions

1. In Google Ads, open **Tools → Lead form extensions → Webhook integration**.
2. Webhook URL = the n8n webhook displayed at the top of the imported
   workflow, e.g. `https://your-n8n.example.com/webhook/google-ads-lead`.
3. Key = anything Google requires; the secret is set inside n8n, not in
   Google.
4. Send a **Send test data** from Google's UI; you should see a 200 in the
   n8n execution log and a new `campaign_targets` row in Axon.

The template maps the `user_column_data` array into a flat object,
falling back across `phone_number / phone / mobile` for the phone field
and `first_name / given_name`, `last_name / family_name` for the name.

### Facebook Lead Ads

The template ships with **two webhooks** sharing the same path
`/webhook/facebook-lead`:

- `GET` → verifies `hub.verify_token` against `FB_VERIFY_TOKEN`, echoes
  `hub.challenge`. Use this URL in Meta's webhook configuration.
- `POST` → parses the `leadgen` change payload and forwards it to
  `/api/leads/inbound`.

Note: Facebook only delivers the `leadgen_id` and metadata by default.
If you need the full `field_data`, add an HTTP node before the POST that
calls `https://graph.facebook.com/v19.0/{{ $json.lead_id }}?fields=field_data,created_time&access_token=...`
with a Page access token, then merge the response into the payload. The
template assumes `field_data` is already present (test mode).

### Google Sheets (CSV import)

Useful when your team drops a CSV into a Google Sheet:

- Trigger fires every minute on **Row added**.
- Required columns (case-insensitive): `phone` (or `e164` / `mobile`),
  optionally `first_name`, `last_name`, `name`, `email`. Any other column
  is forwarded under `metadata.raw`.
- Rows without a phone number are skipped.

To bulk-load an existing CSV, paste it into the sheet — n8n will pick up
each new row.

## 3. Speed-to-lead

Each campaign has a `speed_to_lead_secs` column (default 60).
If the lead reaches Axon within that window, the resulting target jumps to
**priority 0** so the dialer worker picks it up before older targets. The
dialer is expected to order pending targets by
`(priority asc, next_attempt_at asc)` — see index
`idx_campaign_targets_priority` in `supabase/migrations/0017_leads_inbound.sql`.

To tune the window per campaign:

```sql
update campaigns set speed_to_lead_secs = 120 where id = '...';
```

## 4. Troubleshooting

| Symptom                                      | Likely cause                                              |
| -------------------------------------------- | --------------------------------------------------------- |
| `401 secret invalide`                        | Wrong / disabled / deleted secret. Regenerate one.        |
| `409 aucune campagne active pour cette org` | Create a campaign first, or attach a default to the secret. |
| `400 e164 manquant`                          | The connector did not map the phone field — check Code node. |
| Lead appears but `priority = 5`              | `lead_created_at` missing/older than `speed_to_lead_secs`. |
