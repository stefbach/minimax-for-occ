-- Sprint 1 — Security hardening.
--
-- Lock down tables that were previously left wide open (`USING (true)`) with
-- strict org-scoped RLS. Every read & write path must now resolve to a
-- membership in the row's org via the existing `public.is_member_of(uuid)`
-- helper.
--
-- Tables affected:
--   agents, documents, agent_n8n_workflows, agent_runs,
--   inbound_webhook_secrets, voices.
--
-- For `voices` we add `org_id` (nullable) so cloned voices can be scoped to a
-- single org while keeping the seeded presets (org_id IS NULL) globally
-- readable for the voice picker.

-- ─────────────────────────── agents ───────────────────────────
alter table public.agents enable row level security;
drop policy if exists "open_all_agents" on public.agents;
drop policy if exists "agents_owner" on public.agents;
drop policy if exists "agents_org" on public.agents;
create policy "agents_org" on public.agents
  for all
  using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

-- ─────────────────────────── documents ───────────────────────────
alter table public.documents enable row level security;
drop policy if exists "open_all_documents" on public.documents;
drop policy if exists "documents_via_agent" on public.documents;
create policy "documents_via_agent" on public.documents
  for all
  using (
    exists (
      select 1 from public.agents a
      where a.id = documents.agent_id
        and public.is_member_of(a.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.agents a
      where a.id = documents.agent_id
        and public.is_member_of(a.org_id)
    )
  );

-- ─────────────────────────── agent_n8n_workflows ───────────────────────────
alter table public.agent_n8n_workflows enable row level security;
drop policy if exists "open_all_n8n" on public.agent_n8n_workflows;
drop policy if exists "open_all_agent_n8n_workflows" on public.agent_n8n_workflows;
drop policy if exists "an8n_via_agent" on public.agent_n8n_workflows;
create policy "an8n_via_agent" on public.agent_n8n_workflows
  for all
  using (
    exists (
      select 1 from public.agents a
      where a.id = agent_n8n_workflows.agent_id
        and public.is_member_of(a.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.agents a
      where a.id = agent_n8n_workflows.agent_id
        and public.is_member_of(a.org_id)
    )
  );

-- ─────────────────────────── agent_runs ───────────────────────────
alter table public.agent_runs enable row level security;
drop policy if exists "open_all_runs" on public.agent_runs;
drop policy if exists "open_all_agent_runs" on public.agent_runs;
drop policy if exists "runs_via_agent" on public.agent_runs;
create policy "runs_via_agent" on public.agent_runs
  for all
  using (
    exists (
      select 1 from public.agents a
      where a.id = agent_runs.agent_id
        and public.is_member_of(a.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.agents a
      where a.id = agent_runs.agent_id
        and public.is_member_of(a.org_id)
    )
  );

-- ─────────────────────────── inbound_webhook_secrets ───────────────────────────
alter table public.inbound_webhook_secrets enable row level security;
drop policy if exists "iws_org" on public.inbound_webhook_secrets;
create policy "iws_org" on public.inbound_webhook_secrets
  for all
  using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

-- ─────────────────────────── voices ───────────────────────────
-- Make voices org-scoped (nullable so seeded presets remain global).
alter table public.voices
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;
create index if not exists idx_voices_org on public.voices (org_id);

alter table public.voices enable row level security;
drop policy if exists "open_all_voices" on public.voices;
drop policy if exists "voices_org_or_preset" on public.voices;
drop policy if exists "voices_insert_own" on public.voices;
drop policy if exists "voices_update_own" on public.voices;
drop policy if exists "voices_delete_own" on public.voices;

-- Presets (org_id IS NULL) are readable by every authenticated user; cloned
-- voices are visible only to members of the owning org.
create policy "voices_org_or_preset" on public.voices
  for select
  using (org_id is null or public.is_member_of(org_id));

create policy "voices_insert_own" on public.voices
  for insert
  with check (org_id is null or public.is_member_of(org_id));

create policy "voices_update_own" on public.voices
  for update
  using (org_id is null or public.is_member_of(org_id))
  with check (org_id is null or public.is_member_of(org_id));

-- Deletes only allowed for org-owned voices (never the global presets).
create policy "voices_delete_own" on public.voices
  for delete
  using (org_id is not null and public.is_member_of(org_id));
