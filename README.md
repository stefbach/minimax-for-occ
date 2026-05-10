# Axon · Voice Agent Platform

Multi-agent voice + chat console powered by **LiveKit Agents** (real-time WebRTC),
**MiniMax** (TTS + voice cloning), **OpenAI / Anthropic / MiniMax** (LLM brains),
**Deepgram** (multilingual STT), **n8n** (workflow tools), and **Supabase + pgvector** (storage + RAG).

Everything is configured from a Next.js dashboard deployed on Vercel — no YAML, no
redeploy on every change. Workflows are composed visually inside an embedded
n8n editor; voices are cloned from the browser; agents are CRUDable; the Python
worker reloads its configuration per session from Supabase.

```
┌────────────────────────────┐         ┌──────────────────────────────┐
│  Vercel (Next.js)          │  WebRTC │  LiveKit Cloud (SFU)         │
│  · Multi-agent dashboard   │◄───────►│  Room audio bidirectional    │
│  · Voice Studio (clone)    │         └────────────┬─────────────────┘
│  · Workflow builder (n8n)  │                      │ join as agent
│  · RAG (pgvector)          │                      │
│  · /api/token, /api/chat,  │         ┌────────────▼─────────────────┐
│    /api/voices, /api/n8n,  │         │  Worker Python (LiveKit      │
│    /api/agents…            │         │  Agents 1.5)                 │
└────────────┬───────────────┘         │  STT  Deepgram nova-3 multi  │
             │                         │  LLM  per-agent (OpenAI /    │
             │                         │       Anthropic / MiniMax)   │
   ┌─────────▼──────────┐              │  TTS  MiniMax (cloned voice  │
   │  Supabase          │◄─────────────┤        + speech-02-hd…)      │
   │  · agents          │              │  RAG  match_documents RPC    │
   │  · voices          │              │  Tools n8n scoped per agent  │
   │  · documents+vec   │              └──────────────────────────────┘
   │  · agent_n8n_*     │
   │  · agent_runs      │              ┌──────────────────────────────┐
   └────────────────────┘              │  n8n (self-hosted)           │
                                       │  · 4 templates 1-click       │
                                       │  · Visual editor (iframe)    │
                                       │  · Webhook triggers per agent│
                                       └──────────────────────────────┘
```

> ⚠️ **The Python worker does NOT run on Vercel.** Voice sessions are
> long-lived WebRTC and serverless can't host them. The worker runs on
> **LiveKit Cloud Agents** (`lk agent deploy`), or any Docker host.

---

## Table of contents

1. [Features](#features)
2. [Repo layout](#repo-layout)
3. [Setup](#setup)
   - [1. Supabase](#1-supabase)
   - [2. Vercel front-end](#2-vercel-front-end)
   - [3. LiveKit Cloud Agents (Python worker)](#3-livekit-cloud-agents-python-worker)
   - [4. n8n](#4-n8n)
   - [5. Twilio SIP telephony (optional)](#5-twilio-sip-telephony-optional)
4. [Day-to-day workflows](#day-to-day-workflows)
5. [API reference](#api-reference)
6. [Database schema](#database-schema)
7. [Worker architecture](#worker-architecture)
8. [Troubleshooting](#troubleshooting)
9. [Roadmap](#roadmap)

---

## Features

### Multi-agent CRUD

Each agent persona stored in `public.agents` carries its own:

- **Identity** — name, description, target language (`multi`, `fr`, `en`, …).
- **LLM brain** — provider (`openai` / `anthropic` / `minimax`) + model.
- **Voice (MiniMax TTS)** — `tts_voice_id` (cloned or preset), TTS model
  (`speech-02-hd`, `speech-2.5-hd-preview`, `speech-02-turbo`, …),
  emotion, speed, greeting line.
- **System prompt** — free-form text, supports any language.
- **RAG toggle** — on/off + top-K passages.
- **n8n bindings** — whitelisted workflows the agent can trigger as tools.
- **Documents** — RAG corpus chunked + embedded with
  `text-embedding-3-small` (1536 dim, HNSW cosine index).

CRUD lives at `/agents`, `/agents/new`, `/agents/[id]`, `/agents/[id]/edit`.

### Voice Studio (`/voices`)

- Upload an audio sample (10 s – 5 min, mono, ≤ 20 MB) → MiniMax `/files/upload`
  + `/voice_clone` → row persisted in `public.voices`.
- Preset voices catalog (operator-curated; the legacy presets seeded in 0002
  were removed in 0004 because they weren't reliable on newer models).
- One-click "▶ Tester" — synthesizes the voice through `/t2a_v2` with the
  selected TTS model, returns `audio/mpeg` and plays in-browser.
- "Diagnostic MiniMax" panel — smoke-tests the credentials against
  `/get_voice` and reports per-check status with the exact failure
  (HTTP code, `base_resp` message, missing `MINIMAX_GROUP_ID`).
- Agent form picks voices through a dropdown grouped by source
  (cloned / preset).

### Workflow builder (`/workflows`)

- **Connect** — list every workflow on your n8n instance with its tags
  and webhook paths.
- **Create from template** — `/workflows/new` exposes 4 starter
  templates (echo, book-appointment, send-email, supabase-insert).
  Pick a slug, optional "activate immediately", click → workflow lands
  on n8n tagged `voice-agent`, ready to bind.
- **Edit visually** — `/workflows/[id]` embeds the n8n drag-drop editor
  in an iframe (set `N8N_SECURITY_HEADERS_FRAME_ANCESTORS` on your
  n8n instance to allow it; otherwise the page falls back to an
  "open in new tab" link).
- **Bind per agent** — agent detail tab "Workflows n8n" lists active
  workflows and lets you bind/toggle/unbind which ones the agent can
  trigger. Each binding has an LLM-visible description.

### RAG (`/agents/[id]?tab=rag`, `/documents`)

- Drop text or upload `.txt` / `.md` per agent.
- Server-side: `chunkText` (~700-char paragraphs with overlap) →
  `text-embedding-3-small` (OpenAI) → `INSERT INTO documents`.
- Retrieval: `match_documents(agent, embedding, k, threshold)` SQL
  function (cosine kNN, agent-scoped). Used by `/api/chat` and by the
  Python worker's `search_knowledge_base` tool.

### Voice + chat session per agent (`/agents/[id]`)

- **Voice panel** — `/api/token` mints a LiveKit JWT with `agent_id`
  embedded in both the room metadata and participant attributes.
- **Chat panel** — `/api/chat` looks up the agent's system prompt
  + runs RAG retrieval, streams via `@ai-sdk/openai`.
- Tabs persist in URL (`?tab=session` / `?tab=n8n` / `?tab=rag`).

### Telephony (`/api/twilio-voice`)

- TwiML route that bridges a Twilio Voice number into a LiveKit SIP
  room, passing caller `From`/`To` as URI params.
- The Python worker auto-dispatches on every SIP-originated room, so
  the same agent persona answers phone calls.

### Observability (`/settings`)

- Live env-var presence checks (Supabase, OpenAI, LiveKit, MiniMax,
  Deepgram, n8n).
- LiveKit dashboard's Agent Observability captures transcripts and
  audio when enabled at the project level.

---

## Repo layout

```
.
├── README.md                                       (this file)
├── .devcontainer/                                  (GitHub Codespaces — terminal in browser)
│   ├── devcontainer.json
│   └── post-create.sh                              (installs Python, lk CLI, npm deps)
├── docs/
│   └── deploy-agent.workflow.yml                   (paste into .github/workflows/ for CI/CD)
├── supabase/
│   └── migrations/
│       ├── 0001_axon_init.sql                      (agents, n8n bindings, documents+vec, runs, RPC)
│       ├── 0002_voices.sql                         (voices catalog)
│       ├── 0003_agent_tts_model.sql                (per-agent TTS model)
│       ├── 0004_voices_cleanup.sql                 (drops fake legacy presets)
│       └── 0005_grant_public_roles.sql             (GRANTs for anon/authenticated/service_role)
├── web/                                            (Next.js 15, App Router, deployed to Vercel)
│   ├── app/
│   │   ├── (app)/                                  (sidebar shell route group)
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                            (landing + animated SVG brain)
│   │   │   ├── agents/{page,new,[id]/{page,edit}}.tsx
│   │   │   ├── voices/page.tsx                     (Voice Studio)
│   │   │   ├── workflows/{page,new,[id]/page}.tsx  (n8n builder)
│   │   │   ├── documents/page.tsx                  (RAG corpus index)
│   │   │   └── settings/page.tsx
│   │   ├── api/
│   │   │   ├── agents/[id]/{route,n8n,documents}.ts
│   │   │   ├── n8n/{trigger,workflows}/route.ts
│   │   │   ├── voices/{route,preview,diagnostic}/route.ts
│   │   │   ├── token/route.ts                      (LiveKit JWT, embeds agent_id)
│   │   │   ├── chat/route.ts                       (OpenAI + RAG retrieval)
│   │   │   └── twilio-voice/route.ts               (TwiML SIP bridge)
│   │   ├── globals.css, layout.tsx
│   ├── components/
│   │   ├── Sidebar.tsx, brand/{Brand,BrainHero}.tsx
│   │   ├── agent/{AgentForm,AgentSession,AgentN8nBindings,AgentDocuments,ChatPanel}.tsx
│   │   ├── voice/{VoicePanel,VoiceStudio}.tsx
│   │   └── workflow/CreateWorkflowForm.tsx
│   ├── lib/
│   │   ├── supabase.ts, types.ts, embed.ts, n8n.ts, minimax.ts,
│   │   ├── rate-limit.ts, workflow-templates.ts
│   ├── package.json, next.config.mjs, tsconfig.json, vercel.json
│   └── .env.example
├── agent/                                          (Python LiveKit worker)
│   ├── agent.py                                    (entrypoint, per-agent STT/LLM/TTS factories)
│   ├── agent_config.py                             (Supabase-backed AxonAgent + RAG search)
│   ├── n8n_tools.py                                (build_n8n_tools, build_scoped_n8n_tools)
│   ├── clone_voice.py                              (CLI helper, superseded by Voice Studio)
│   ├── requirements.txt, Dockerfile, livekit.toml
│   ├── sip/                                        (LiveKit SIP trunk + dispatch JSON)
│   └── .env.example
└── n8n/
    ├── README.md
    └── workflows/book-appointment.json             (importable example)
```

---

## Setup

### 1. Supabase

1. Create a project on [supabase.com](https://supabase.com) (free tier OK).
2. **Database → Extensions** — enable **vector** and **uuid-ossp**
   (the SQL `create extension` calls won't work on some plans without
   the UI toggle).
3. **SQL Editor** — paste each migration file in order and Run:
   ```
   supabase/migrations/0001_axon_init.sql
   supabase/migrations/0002_voices.sql
   supabase/migrations/0003_agent_tts_model.sql
   supabase/migrations/0004_voices_cleanup.sql
   supabase/migrations/0005_grant_public_roles.sql       ← critical
   ```
   You can also paste them as one big script.
4. Verify with:
   ```sql
   select table_name
   from information_schema.tables
   where table_schema = 'public'
     and table_name in ('agents','agent_n8n_workflows','agent_runs','documents','voices');
   ```
   Expected: 5 rows.
5. **Storage** (optional, future RAG file uploads) — create a bucket
   named `voice-samples` if you want to keep the original uploaded
   audio for later replay.

> If you ever see `ERROR: 42P01: relation "public.agents" does not exist`,
> migration 0001 didn't apply. If you see `permission denied for table …`,
> migration 0005 didn't apply.

### 2. Vercel front-end

```bash
cd web
vercel
```

When asked, set **Root Directory** to `web` (we keep the worker
separate). Then in **Settings → Environment Variables**, fill these in
for *Production + Preview + Development*:

| Variable | Used by |
|---|---|
| `SUPABASE_URL` | server (REST + RPC) |
| `SUPABASE_SERVICE_ROLE_KEY` | server (full access, RLS-bypass) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | exposed to browser, optional today |
| `OPENAI_API_KEY` | `/api/chat`, `/api/agents/[id]/documents` (embeddings) |
| `NEXT_PUBLIC_LIVEKIT_URL` | browser → SFU |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `/api/token` JWT minting |
| `MINIMAX_API_KEY` | Voice Studio (cloning, preview), `/api/voices` |
| `MINIMAX_BASE_URL` *(opt)* | switch to `https://api.minimaxi.com/v1` for China accounts |
| `MINIMAX_GROUP_ID` *(opt)* | required by `/t2a_v2` on some account types |
| `DEEPGRAM_API_KEY` | not used by the front (worker side) — keep for reference |
| `N8N_BASE_URL` | `/api/n8n/workflows`, `/api/n8n/trigger`, iframe editor |
| `N8N_API_KEY` | n8n public API auth (`X-N8N-API-KEY`) |
| `LIVEKIT_SIP_URI` *(opt)* | Twilio TwiML bridge target |
| `APP_SHARED_TOKEN` *(opt)* | `/api/token` bearer for non-browser callers |
| `TOKEN_RATE_LIMIT_PER_MINUTE` *(opt, default 20)* | `/api/token` rate limiter |

Redeploy without cache after adding/changing env vars.

### 3. LiveKit Cloud Agents (Python worker)

The worker runs on **LiveKit Cloud Agents** (recommended) or any
container host. Three deployment paths are supported:

#### Option A — local terminal

```bash
curl -sSL https://get.livekit.io/cli | bash
lk cloud auth
cd agent
cp .env.example .env       # fill in keys (Supabase, OpenAI, MiniMax, Deepgram, n8n)
lk agent deploy            # build the Docker image and ship a new version
```

#### Option B — GitHub Codespaces (zero-install browser terminal)

On GitHub → green **Code** → **Codespaces** → **Create codespace on main**.
Wait ~1 min while `.devcontainer/post-create.sh` installs Python, the
LiveKit CLI, npm deps and pre-downloads Silero VAD + turn-detector
weights. Then in the Codespace terminal:

```bash
cd agent
cp .env.example .env       # edit → add real keys
lk cloud auth              # confirm in browser, pick the project
lk agent deploy
```

#### Option C — GitHub Actions (CI/CD)

Copy `docs/deploy-agent.workflow.yml` into `.github/workflows/deploy-agent.yml`
via the GitHub UI (the harness can't write under `.github/` itself), set
the same secrets in **repo Settings → Secrets and variables → Actions**,
and every push touching `agent/**` redeploys the worker.

#### `update` vs `deploy`

| Command | What it does |
|---|---|
| `lk agent deploy` | Rebuilds the Docker image and ships a new version. Use when code changes. |
| `lk agent update` | Updates secrets / metadata only, restarts the agent. Use when only secrets change. |

LiveKit Cloud caches Docker layers, so we bump
`agent/Dockerfile`'s `LABEL build_id="…"` to bust the cache when a
silent re-deploy is needed.

#### Worker secrets

Set in **Cloud → Agents → your agent → Secrets**:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
MINIMAX_API_KEY
DEEPGRAM_API_KEY
N8N_BASE_URL
N8N_API_KEY
ANTHROPIC_API_KEY    # optional, only if any agent has llm_provider = anthropic
```

### 4. n8n

- Self-hosted or cloud, both work. Tested on a Hostinger n8n.
- Generate a Public API key — **Settings → API → Create**.
- Optionally set `N8N_SECURITY_HEADERS_FRAME_ANCESTORS=*` (or your
  exact Vercel URL) to allow the embedded editor inside Axon.
- Workflows tagged `voice-agent` are auto-discovered by the
  agent-binding UI; the `/workflows/new` builder tags new ones for you.

### 5. Twilio SIP telephony (optional)

See `agent/sip/README.md` for the full procedure. Short version:

1. Twilio Elastic SIP Trunk → Origination URI =
   `sip:<your-project>.sip.livekit.cloud`.
2. `lk sip inbound-trunk create agent/sip/inbound-trunk.json`.
3. `lk sip dispatch-rule create agent/sip/dispatch-rule.json`.
4. The worker auto-dispatches on every SIP-originated room, so callers
   talk to the same agent personas you defined in the dashboard.

---

## Day-to-day workflows

### Create a new agent persona

1. **Dashboard** → **+ Créer un agent**.
2. Pick LLM provider + model, language, voice (dropdown from Voice
   Studio), TTS model (`speech-02-hd` recommended), greeting, system
   prompt.
3. Save → land on `/agents/[id]?tab=session`.
4. Click **▶ Écouter cette voix** to validate the TTS pipeline.
5. **Démarrer la session vocale** → talk to the agent through WebRTC.

### Clone a voice

1. **Voice Studio** → upload a 10 s – 5 min audio sample.
2. Choose a `voice_id` (8–64 chars, starts with a letter,
   `[A-Za-z0-9_]`).
3. Click **Cloner cette voix** → registered on MiniMax + persisted in
   Supabase.
4. **▶ Tester** — listen to a synthesized greeting in the new voice.
5. Pick the new voice from the agent form's dropdown.

### Build a workflow

1. **Workflows n8n** → **+ Nouveau workflow**.
2. Pick a template (echo / book-appointment / send-email /
   supabase-insert), give it a slug, tick "activate immediately".
3. Click **Créer** → workflow created on n8n, tagged `voice-agent`.
4. Open the **embedded editor** to refine nodes (or "Ouvrir n8n ↗").
5. **Bind to an agent** — agent detail → tab "Workflows n8n" →
   ↻ Refresh → click the path under "Workflows disponibles".

The agent's LLM now has a function tool per bound workflow,
named `n8n_<sanitized-path>` with the binding's description as
docstring. The agent can call it during a voice/chat session.

### Add documents to an agent's RAG

1. Agent detail → tab "RAG / Documents".
2. Either type/paste content with a name, or upload a `.txt` / `.md`.
3. Server chunks (~700 chars) + embeds via OpenAI + stores in pgvector.
4. Toggle the agent's **Activer la recherche documentaire** in the
   form (top-K configurable).
5. The chat route auto-injects the top-K passages as system context;
   the worker exposes a `search_knowledge_base` tool to the LLM.

---

## API reference

All routes are under `/api/`, Node.js runtime, JSON unless noted.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents` | List agents (latest first). |
| `POST` | `/api/agents` | Create. Body = `AgentInput`. |
| `GET` | `/api/agents/[id]` | Read. |
| `PUT` | `/api/agents/[id]` | Whitelisted partial update. |
| `DELETE` | `/api/agents/[id]` | Delete (cascades to bindings + docs). |
| `GET` | `/api/agents/[id]/n8n` | List bindings. |
| `POST` | `/api/agents/[id]/n8n` | Upsert binding (used as toggle too). |
| `DELETE` | `/api/agents/[id]/n8n?binding_id=…` | Unbind. |
| `GET` | `/api/agents/[id]/documents` | List chunked docs. |
| `POST` | `/api/agents/[id]/documents` | Ingest `{ source_name, content }`. |
| `DELETE` | `/api/agents/[id]/documents?doc_id=…` *or* `?source=…` | Delete chunk(s). |
| `GET` | `/api/voices` | List voices. |
| `POST` | `/api/voices` *(multipart)* | Upload sample → MiniMax clone → persist. |
| `DELETE` | `/api/voices?id=…` | Drop voice. |
| `POST` | `/api/voices/preview` | TTS synthesis, returns `audio/mpeg`. |
| `GET` | `/api/voices/diagnostic` | Smoke-test MiniMax credentials. |
| `GET` | `/api/n8n/workflows[?active=true|false]` | Discover workflows. |
| `POST` | `/api/n8n/workflows` | Create from template `{ template, slug, activate? }` *or* raw `{ workflow }`. |
| `GET` | `/api/n8n/trigger` | Same as workflows GET (legacy). |
| `POST` | `/api/n8n/trigger` | Body `{ webhook_path, payload }` → fires the webhook. |
| `GET` | `/api/token[?agent_id=…&room=…&identity=…]` | Mint LiveKit JWT, embeds `agent_id`. |
| `POST` | `/api/chat` | AI SDK v6 streaming chat, RAG-augmented per agent. |
| `POST` | `/api/twilio-voice` | TwiML bridge → LiveKit SIP. |

---

## Database schema

`public.agents`
```
id uuid pk · name text · description text · language text default 'multi'
llm_provider text · llm_model text default 'gpt-4o'
tts_voice_id text · tts_emotion text · tts_speed real · tts_model text
system_prompt text · greeting text · rag_enabled bool · rag_top_k int
metadata jsonb · created_at · updated_at (auto trigger)
```

`public.agent_n8n_workflows`
```
id uuid pk · agent_id uuid fk → agents
workflow_id text · workflow_name text · webhook_path text
description text · payload_schema jsonb · enabled bool
unique (agent_id, webhook_path)
```

`public.documents`
```
id uuid pk · agent_id uuid fk → agents
source_name text · chunk_index int · content text
embedding vector(1536) · metadata jsonb
HNSW index on embedding (vector_cosine_ops)
```

`public.agent_runs`
```
id uuid pk · agent_id uuid · room_id text · channel text
transcript jsonb · started_at · ended_at
```

`public.voices`
```
id uuid pk · voice_id text unique · display_name text · language text
source text in ('cloned','preset') · description text · sample_text text
metadata jsonb · created_at
```

`public.match_documents(agent uuid, query_embedding vector(1536), match_count int, threshold real)`
returns the top-K most similar chunks for the agent (cosine kNN).

RLS is enabled on every table with permissive `using (true)` policies
for now (single-tenant, no auth UI). Switch to per-organization
policies before opening to multiple tenants.

---

## Worker architecture

```
agent.py
├── entrypoint(JobContext)
│   ├── ctx.connect()
│   ├── resolve_agent_id (room metadata or participant attributes)
│   ├── load_agent(agent_id) → AxonAgent (Supabase REST)
│   ├── _llm_for(axon)        → openai.LLM | anthropic.LLM (provider switch)
│   ├── _tts_for(axon)        → minimax.TTS (voice_id, model, emotion, speed)
│   ├── tools = build_scoped_n8n_tools(...) + (search_knowledge_base if rag_enabled)
│   └── session.start(room=ctx.room, agent=AxonVoiceAgent(instructions, tools, greeting))
│
└── AxonVoiceAgent.on_enter()
    └── self.session.say(greeting, allow_interruptions=True)
        # Pure TTS — bypasses LiveKit's default empty-message LLM call
        # (which MiniMax-M2 used to reject with HTTP 400 'chat content
        # is empty (2013)' — see PR #6 / #7).

agent_config.py
├── load_agent(agent_id) → AxonAgent
├── rag_search(agent_id, query, top_k) → list of passages
└── resolve_agent_id(room_metadata, participant_attributes)

n8n_tools.py
├── build_n8n_tools(client)              # generic list/trigger/get_execution
└── build_scoped_n8n_tools(client, list) # one tool per whitelisted webhook
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `42P01: relation "public.agents" does not exist` | Migration 0001 not applied | Run `supabase/migrations/0001_axon_init.sql` in the SQL editor (or all of them). |
| `permission denied for table agents` (and similar) | Migration 0005 not applied | Run `supabase/migrations/0005_grant_public_roles.sql`. |
| Vercel build = "Build Completed in 31ms" then 404 | Root Directory is `./` instead of `web` | Settings → General → Root Directory → `web` → Save → Redeploy. |
| Vercel build green but URL still 404 | URL is the production alias and Production Branch isn't set | Settings → Git → Production Branch → `main` (or merge your feature branch). |
| `chat content is empty (2013)` from MiniMax in worker logs | LiveKit framework called `generate_reply` before the user spoke | The fix lives in `AxonVoiceAgent.on_enter` → `session.say`; if you customized `agent.py`, keep this override. |
| Same error after `lk agent update` | `update` doesn't rebuild the image | Use `lk agent deploy`. Bump `Dockerfile`'s `LABEL build_id` if necessary. |
| `MINIMAX TTS error 1027` / `insufficient_balance` | Wallet on the *wrong* MiniMax account, or zero balance | `https://platform.minimax.io` → Wallet → check the account that owns `MINIMAX_API_KEY`. |
| Voice Studio "▶ Tester" hangs | Diagnostic panel will tell you exactly which check failed (often missing `MINIMAX_GROUP_ID` for some accounts) | Click "Tester la connexion" first. |
| n8n editor iframe is blank | n8n blocks `frame-ancestors` by default | Set `N8N_SECURITY_HEADERS_FRAME_ANCESTORS=*` (or your Vercel URL) on the n8n instance. |
| `lk agent create` says `maximum number of agents reached (1/1)` | Free tier limit | `lk agent delete --id CA_…` then `lk agent deploy` (or upgrade). |

---

## Roadmap

Done in this repo:
- ✅ Multi-agent CRUD with provider-pluggable LLM brain.
- ✅ Voice Studio: clone, preview, manage MiniMax voices.
- ✅ Workflow builder: templates, embedded editor, agent bindings.
- ✅ RAG with pgvector, per-agent.
- ✅ LiveKit voice + chat session per agent.
- ✅ Twilio SIP path documented and working.
- ✅ GitHub Codespaces dev container, Actions CI/CD blueprint.

Open follow-ups:
- 🔲 Auth + multi-tenant orgs (replace open RLS with policies).
- 🔲 Storage of voice clone samples in Supabase Storage for replay.
- 🔲 Per-agent analytics dashboard (sessions, durations, tool calls).
- 🔲 Prebuilt n8n recipes for Slack / Gmail / Notion / Calendar with credentials wizard.
- 🔲 In-house workflow editor (replace iframe) when scope justifies it.
