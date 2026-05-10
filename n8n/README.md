# n8n example workflows

Import via the n8n UI: **Workflows → "+" → Import from File**.

## book-appointment.json

Minimal workflow that the voice agent can trigger:

- **Webhook** (POST `/webhook/book-appointment`)
- **Set** node builds a fake confirmation id from the input
- **Respond to Webhook** returns JSON synchronously

After import: open the workflow → toggle **Active** ON → the agent's
`list_n8n_workflows` tool will discover it and `trigger_n8n_workflow` can fire
it with payload like `{"date":"2026-05-11T15:00","customer":"Stéphane"}`.

Try it locally:

```bash
curl -X POST https://your-n8n.example.cloud/webhook/book-appointment \
     -H 'content-type: application/json' \
     -d '{"date":"2026-05-11T15:00"}'
```
