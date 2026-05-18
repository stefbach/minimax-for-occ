# Copilote Super Admin

The Copilot is a chat-driven interface that lets a `super_admin` user drive
the Axon platform — n8n, Supabase, agents, RAG — using natural language. The
LLM (OpenAI `gpt-4o`) is wired to a set of typed tools and the UI renders each
tool call as an inspectable card.

## Access

- URL : `/admin/copilot`
- Role : **`super_admin` only** (enforced both server-side and via the sidebar).
  The page redirects to `/admin` for any other role.
- API : `POST /api/copilot/chat` returns 403 unless the caller has a
  `super_admin` membership.

## Safety model

Every tool falls in one of two safety classes:

| Class | Examples                                  | Behaviour                                                                                                         |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| read  | `list_orgs`, `n8n_list_workflows`, `supabase_query` on a SELECT, `rag_search` | Executed immediately, no audit row, result returned to the LLM straight away. |
| write | `create_org`, `create_agent`, `n8n_create_workflow`, `n8n_update_workflow`, `n8n_activate_workflow`, `supabase_query` on writes, `rag_add_document` | Inserted as a `pending` row in `public.copilot_actions`. The tool returns `{ pending: true, action_id, summary }` so the LLM can describe the change. The user has to click **Confirmer** to actually run it. |

### `supabase_query`

This is the only tool that exposes raw SQL, so it has the strictest pipeline :

1. The SQL is classified by regex into `read` / `write` / `dangerous`.
   - `read` = `SELECT` / `EXPLAIN` / `WITH`-only queries.
   - `write` = `INSERT`, `UPDATE`, `MERGE`, `COPY`, `CREATE TABLE`, …
   - `dangerous` = anything matching `DROP|TRUNCATE|DELETE|ALTER|GRANT|REVOKE|CREATE ROLE|CREATE USER`.
2. `dangerous` SQL is **refused** unless the LLM re-issues with `force=true`.
   Even then it's only staged — the user still has to click Confirmer.
3. `write` SQL is run as `BEGIN; <sql>; ROLLBACK;` as a dry-run preview to feed
   back to the LLM, while the actual execution is staged for confirmation.
4. `read` SQL runs immediately via the Supabase RPC `exec_sql_admin`. If the
   project hasn't provisioned that function the tool surfaces a friendly
   "not available" note instead of silently failing.

> **Note:** the `exec_sql_admin` RPC is intentionally **not** created by this
> migration — it would otherwise give the service-role key arbitrary SQL by
> default. Operators who want raw SQL must opt in by creating it themselves
> (a `security definer` function returning `jsonb`).

## Audit log

The `public.copilot_actions` table records every write attempt :

```
id          uuid
org_id      uuid?
user_id     uuid       -- auth.users.id of the super_admin who issued it
tool_name   text       -- e.g. "n8n_create_workflow"
arguments   jsonb
result      jsonb?     -- populated after execution
status      text       -- pending | confirmed | executed | failed | rejected
error       text?
created_at  timestamptz
executed_at timestamptz?
```

RLS restricts visibility to `super_admin` rows; the service role bypasses RLS
for the route handlers, but they always filter `user_id = auth.uid()` so one
super_admin never sees another super_admin's pending actions in the UI.

## Tool catalogue

### Platform

- `list_orgs()` — list organisations.
- `create_org({ name, slug })` — **write**, requires confirmation.
- `list_agents({ org_id? })` — list agents, optionally scoped to an org.
- `create_agent({ org_id, name, system_prompt?, voice_id?, llm_model? })` — **write**.

### n8n

- `n8n_list_workflows({ active? })`
- `n8n_get_workflow({ id })`
- `n8n_create_workflow({ name, nodes, connections, active? })` — **write**.
- `n8n_update_workflow({ id, name?, nodes?, connections? })` — **write**.
- `n8n_activate_workflow({ id, active? })` — **write**.

### Supabase

- `supabase_query({ sql, force? })` — read straight away ; writes staged ;
  destructive blocked unless `force=true`.

### RAG

- `rag_add_document({ agent_id, text, source? })` — **write** ; chunk + embed
  + insert into `public.documents`.
- `rag_search({ agent_id, query, k })` — read.

## Example prompts

- _"Liste mes organisations puis crée une org Demo avec slug demo."_
- _"Quels workflows n8n sont inactifs ? Active celui qui s'appelle `voice-agent-prod`."_
- _"SELECT count(\*) from calls where started_at >= now() - interval '24h'."_
- _"Ajoute ce texte dans le RAG de l'agent `<uuid>` : « politique de remboursement … »."_
- _"Montre-moi les 4 chunks les plus similaires à « durée de garantie » dans l'agent `<uuid>`."_

## Files

- Migration : `supabase/migrations/0021_copilot_audit.sql`
- API : `web/app/api/copilot/chat/route.ts`,
  `web/app/api/copilot/actions/route.ts`,
  `web/app/api/copilot/actions/[id]/confirm/route.ts`
- Tools : `web/lib/copilot/tools.ts`
- n8n client : `web/lib/n8n-client.ts` (re-exports + JWT helper)
- UI : `web/app/(app)/admin/copilot/page.tsx` + `web/components/admin/CopilotClient.tsx`
- Sidebar entry : `web/components/Sidebar.tsx` (`/admin/copilot`, `roles=["super_admin"]`)

## Environment

Required env vars (already used elsewhere on the platform):

- `OPENAI_API_KEY` — for `gpt-4o` and `text-embedding-3-small`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — service-role client for tool execution.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — cookie-bound client for auth checks.
- `N8N_BASE_URL`, `N8N_API_KEY` — required for any n8n tool.
- `N8N_JWT_SECRET` — optional, only if the n8n proxy requires Bearer JWTs.
