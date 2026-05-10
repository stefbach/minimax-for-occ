/**
 * Starter n8n workflow templates.
 *
 * Each template renders to a complete workflow JSON ready to POST to
 * n8n's `POST /api/v1/workflows`. The webhook path is namespaced under
 * `voice-agent/<slug>` so it never clashes with the user's existing
 * production workflows, and tagged "voice-agent" so Axon's discovery
 * surface picks it up.
 *
 * Add new templates here — the picker in /workflows/new auto-renders.
 */

export interface WorkflowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Generates an n8n workflow definition from a user-chosen unique slug. */
  build: (opts: { slug: string }) => unknown;
}

const VOICE_AGENT_TAG = "voice-agent";

function webhookNode(path: string) {
  return {
    parameters: {
      httpMethod: "POST",
      path,
      responseMode: "responseNode",
      options: {},
    },
    id: "webhook-node-1",
    name: "Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [240, 300],
    webhookId: path,
  };
}

function respondJsonNode(body: string) {
  return {
    parameters: {
      respondWith: "json",
      responseBody: body,
      options: {},
    },
    id: "respond-node-1",
    name: "Respond",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [800, 300],
  };
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    slug: "echo",
    name: "Echo (debug)",
    description:
      "Webhook qui renvoie le payload reçu, plus un timestamp. Idéal pour valider la chaîne agent → n8n.",
    build({ slug }) {
      const path = `voice-agent/${slug}`;
      return {
        name: `[voice-agent] echo ${slug}`,
        nodes: [
          webhookNode(path),
          {
            parameters: {
              assignments: {
                assignments: [
                  { id: "e1", name: "ok", type: "boolean", value: "true" },
                  {
                    id: "e2",
                    name: "received_at",
                    type: "string",
                    value: "={{ $now.toISO() }}",
                  },
                  { id: "e3", name: "echo", type: "object", value: "={{ $json.body }}" },
                ],
              },
              options: {},
            },
            id: "set-node-1",
            name: "Set",
            type: "n8n-nodes-base.set",
            typeVersion: 3.4,
            position: [520, 300],
          },
          respondJsonNode(
            "={{ { ok: $json.ok, received_at: $json.received_at, payload: $json.echo } }}",
          ),
        ],
        connections: {
          Webhook: { main: [[{ node: "Set", type: "main", index: 0 }]] },
          Set: { main: [[{ node: "Respond", type: "main", index: 0 }]] },
        },
        settings: { executionOrder: "v1" },
      };
    },
  },
  {
    slug: "book-appointment",
    name: "Prise de rendez-vous (skeleton)",
    description:
      "Reçoit { date, customer, phone? } et renvoie un confirmation_id. Branchez Google Calendar ou votre CRM ensuite.",
    build({ slug }) {
      const path = `voice-agent/${slug}`;
      return {
        name: `[voice-agent] book-appointment ${slug}`,
        nodes: [
          webhookNode(path),
          {
            parameters: {
              assignments: {
                assignments: [
                  {
                    id: "a1",
                    name: "ok",
                    type: "boolean",
                    value: "={{ $json.body.date !== undefined }}",
                  },
                  {
                    id: "a2",
                    name: "confirmation_id",
                    type: "string",
                    value: "=appt-{{$now.toMillis()}}",
                  },
                  { id: "a3", name: "echo", type: "object", value: "={{ $json.body }}" },
                ],
              },
              options: {},
            },
            id: "set-node-1",
            name: "Build response",
            type: "n8n-nodes-base.set",
            typeVersion: 3.4,
            position: [520, 300],
          },
          respondJsonNode(
            "={{ { ok: $json.ok, confirmation_id: $json.confirmation_id, payload: $json.echo } }}",
          ),
        ],
        connections: {
          Webhook: { main: [[{ node: "Build response", type: "main", index: 0 }]] },
          "Build response": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
        },
        settings: { executionOrder: "v1" },
      };
    },
  },
  {
    slug: "send-email",
    name: "Envoi d'email (skeleton)",
    description:
      "Webhook → noeud SMTP/Gmail (à brancher sur vos credentials). Reçoit { to, subject, body }.",
    build({ slug }) {
      const path = `voice-agent/${slug}`;
      return {
        name: `[voice-agent] send-email ${slug}`,
        nodes: [
          webhookNode(path),
          {
            parameters: {
              assignments: {
                assignments: [
                  { id: "e1", name: "to", type: "string", value: "={{ $json.body.to }}" },
                  { id: "e2", name: "subject", type: "string", value: "={{ $json.body.subject }}" },
                  { id: "e3", name: "body", type: "string", value: "={{ $json.body.body }}" },
                ],
              },
              options: {},
            },
            id: "set-node-1",
            name: "Prepare",
            type: "n8n-nodes-base.set",
            typeVersion: 3.4,
            position: [480, 300],
          },
          {
            parameters: {
              method: "POST",
              url: "https://example.com/replace-with-your-mail-provider",
              sendBody: true,
              jsonBody:
                '={{ { to: $json.to, subject: $json.subject, html: $json.body } }}',
              options: {},
            },
            id: "http-node-1",
            name: "HTTP (à remplacer par Gmail/SMTP)",
            type: "n8n-nodes-base.httpRequest",
            typeVersion: 4.2,
            position: [720, 300],
          },
          respondJsonNode("={{ { ok: true, sent_to: $json.to } }}"),
        ],
        connections: {
          Webhook: { main: [[{ node: "Prepare", type: "main", index: 0 }]] },
          Prepare: {
            main: [[{ node: "HTTP (à remplacer par Gmail/SMTP)", type: "main", index: 0 }]],
          },
          "HTTP (à remplacer par Gmail/SMTP)": {
            main: [[{ node: "Respond", type: "main", index: 0 }]],
          },
        },
        settings: { executionOrder: "v1" },
      };
    },
  },
  {
    slug: "supabase-insert",
    name: "Insert dans Supabase (skeleton)",
    description:
      "Webhook → INSERT vers une table Supabase via PostgREST. Reçoit le body JSON tel quel.",
    build({ slug }) {
      const path = `voice-agent/${slug}`;
      return {
        name: `[voice-agent] supabase-insert ${slug}`,
        nodes: [
          webhookNode(path),
          {
            parameters: {
              method: "POST",
              url: "={{ $env.SUPABASE_URL }}/rest/v1/your_table",
              sendHeaders: true,
              headerParameters: {
                parameters: [
                  { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
                  { name: "Authorization", value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
                  { name: "Content-Type", value: "application/json" },
                  { name: "Prefer", value: "return=representation" },
                ],
              },
              sendBody: true,
              jsonBody: "={{ $json.body }}",
              options: {},
            },
            id: "http-node-1",
            name: "Insert row",
            type: "n8n-nodes-base.httpRequest",
            typeVersion: 4.2,
            position: [520, 300],
          },
          respondJsonNode("={{ { ok: true, inserted: $json } }}"),
        ],
        connections: {
          Webhook: { main: [[{ node: "Insert row", type: "main", index: 0 }]] },
          "Insert row": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
        },
        settings: { executionOrder: "v1" },
      };
    },
  },
];

export const VOICE_AGENT_WORKFLOW_TAG = VOICE_AGENT_TAG;
