-- 0015_agent_teams_and_prompts.sql
-- Phase 3: multi-agent swarm + prompt versioning.
--
-- agent_teams      : an ordered collection of AI agents with one lead/router
-- agent_team_members : individual agents within a team, with a specialty
--                     label + LLM-visible transfer description used by the
--                     `transfer_to_specialist` tool in the Python worker.
-- prompt_versions  : immutable history of (system_prompt, greeting) for an
--                     agent. /agents/[id]/prompt-versions/[v]/restore rolls
--                     a past version back into the live agents row.
--
-- Note: in this repo the agents table is literally `agents` (not `ai_agents`),
-- so all FKs reference public.agents(id). Re-applying is safe (IF NOT EXISTS).

create extension if not exists "uuid-ossp";

-- ─── Teams ────────────────────────────────────────────────────────────────
create table if not exists public.agent_teams (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  lead_agent_id   uuid references public.agents(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_agent_teams_org on public.agent_teams (org_id);

create table if not exists public.agent_team_members (
  id                     uuid primary key default uuid_generate_v4(),
  team_id                uuid not null references public.agent_teams(id) on delete cascade,
  agent_id               uuid not null references public.agents(id) on delete cascade,
  specialty              text,
  transfer_description   text,
  priority               int not null default 1,
  created_at             timestamptz not null default now(),
  unique (team_id, agent_id)
);

create index if not exists idx_agent_team_members_team on public.agent_team_members (team_id);
create index if not exists idx_agent_team_members_agent on public.agent_team_members (agent_id);

alter table public.agent_teams         enable row level security;
alter table public.agent_team_members  enable row level security;

drop policy if exists "agent_teams_org" on public.agent_teams;
create policy "agent_teams_org" on public.agent_teams
  for all using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

drop policy if exists "agent_team_members_via_team" on public.agent_team_members;
create policy "agent_team_members_via_team" on public.agent_team_members
  for all using (
    exists (
      select 1 from public.agent_teams t
      where t.id = team_id and public.is_member_of(t.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.agent_teams t
      where t.id = team_id and public.is_member_of(t.org_id)
    )
  );

-- ─── Prompt versioning ────────────────────────────────────────────────────
create table if not exists public.prompt_versions (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  version         int not null,
  system_prompt   text not null,
  greeting        text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  note            text,
  unique (agent_id, version)
);

create index if not exists idx_prompt_versions_agent
  on public.prompt_versions (agent_id, version desc);

alter table public.prompt_versions enable row level security;

drop policy if exists "prompt_versions_via_agent" on public.prompt_versions;
create policy "prompt_versions_via_agent" on public.prompt_versions
  for all using (
    exists (
      select 1 from public.agents a
      where a.id = agent_id and public.is_member_of(a.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.agents a
      where a.id = agent_id and public.is_member_of(a.org_id)
    )
  );

-- ─── Grants (service_role bypasses RLS by default) ────────────────────────
grant all on public.agent_teams         to anon, authenticated, service_role;
grant all on public.agent_team_members  to anon, authenticated, service_role;
grant all on public.prompt_versions     to anon, authenticated, service_role;
