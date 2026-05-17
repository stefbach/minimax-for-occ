-- =========================================================================
--  Axon v2 — migration "simple"
--  Pas de DO $$ block, pas de PL/pgSQL. Juste des CREATE / ALTER explicites.
--  Idempotent : peut être relancé autant de fois que voulu.
--  À copier-coller intégralement dans Supabase → SQL Editor → Run.
-- =========================================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ─── organizations + memberships ──────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null,
  role        text not null default 'admin',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_memberships_user on public.memberships (user_id);
create index if not exists idx_memberships_org  on public.memberships (org_id);

create or replace function public.is_member_of(org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid()
  );
$$;
grant execute on function public.is_member_of(uuid) to anon, authenticated, service_role;

insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Legacy', 'legacy')
on conflict (id) do nothing;

-- ─── org_id sur les tables v1 (explicite, table par table) ────────────────
alter table public.agents              add column if not exists org_id uuid;
alter table public.agent_n8n_workflows add column if not exists org_id uuid;
alter table public.documents           add column if not exists org_id uuid;
alter table public.agent_runs          add column if not exists org_id uuid;
alter table public.voices              add column if not exists org_id uuid;

update public.agents              set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update public.agent_n8n_workflows set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update public.documents           set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update public.agent_runs          set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
update public.voices              set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;

alter table public.agents              alter column org_id set not null;
alter table public.agent_n8n_workflows alter column org_id set not null;
alter table public.documents           alter column org_id set not null;
alter table public.agent_runs          alter column org_id set not null;
alter table public.voices              alter column org_id set not null;

create index if not exists idx_agents_org              on public.agents (org_id);
create index if not exists idx_agent_n8n_workflows_org on public.agent_n8n_workflows (org_id);
create index if not exists idx_documents_org           on public.documents (org_id);
create index if not exists idx_agent_runs_org          on public.agent_runs (org_id);
create index if not exists idx_voices_org              on public.voices (org_id);

-- ─── Nouvelles tables contact center ──────────────────────────────────────
create table if not exists public.phone_numbers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  e164 text not null unique,
  label text,
  provider text not null default 'twilio',
  provider_sid text,
  flow_id uuid,
  capabilities jsonb default '{"voice":true,"sms":true}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.queues (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  strategy text not null default 'longest_idle',
  max_wait_secs int default 600,
  fallback_voicemail boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists public.agent_handles (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('ai','human')),
  ai_agent_id uuid references public.agents(id) on delete cascade,
  user_id uuid,
  display_name text not null,
  skills text[] default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (kind = 'ai'    and ai_agent_id is not null and user_id is null) or
    (kind = 'human' and user_id     is not null and ai_agent_id is null)
  )
);

create table if not exists public.queue_memberships (
  id uuid primary key default uuid_generate_v4(),
  queue_id uuid not null references public.queues(id) on delete cascade,
  agent_handle_id uuid not null references public.agent_handles(id) on delete cascade,
  priority int not null default 1,
  unique (queue_id, agent_handle_id)
);

create table if not exists public.human_presence (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'offline',
  current_call_id uuid,
  last_seen timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists public.contacts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  e164 text not null,
  display_name text,
  email text,
  tags text[] default '{}',
  attributes jsonb default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, e164)
);

create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  last_event_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.calls (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  state text not null default 'queued' check (state in ('queued','ringing','ivr','in_progress','wrap_up','ended','failed')),
  from_e164 text,
  to_e164 text,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  queue_id uuid references public.queues(id) on delete set null,
  agent_handle_id uuid references public.agent_handles(id) on delete set null,
  room_id text,
  twilio_call_sid text,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_secs int,
  recording_url text,
  transcript_url text,
  disposition text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.call_events (
  id uuid primary key default uuid_generate_v4(),
  call_id uuid not null references public.calls(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  by_user_id uuid,
  payload jsonb default '{}'::jsonb
);

create table if not exists public.event_log (
  id bigserial primary key,
  org_id uuid references public.organizations(id) on delete set null,
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_kind text not null default 'system',
  entity text not null,
  entity_id text,
  action text not null,
  payload jsonb default '{}'::jsonb
);

create table if not exists public.flows (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  start_step_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flow_steps (
  id uuid primary key default uuid_generate_v4(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  kind text not null check (kind in ('welcome','menu_dtmf','gather_speech','ai_agent','transfer','route_queue','voicemail','hangup')),
  label text,
  config jsonb not null default '{}'::jsonb,
  position jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.flow_edges (
  id uuid primary key default uuid_generate_v4(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  from_step_id uuid not null references public.flow_steps(id) on delete cascade,
  to_step_id uuid not null references public.flow_steps(id) on delete cascade,
  condition jsonb not null default '{"kind":"always"}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  agent_handle_id uuid not null references public.agent_handles(id) on delete restrict,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  caller_id_e164 text,
  state text not null default 'draft' check (state in ('draft','scheduled','running','paused','completed','cancelled')),
  schedule jsonb default '{}'::jsonb,
  max_concurrency int not null default 5,
  max_attempts int not null default 3,
  retry_delay_min int not null default 60,
  amd_enabled boolean not null default true,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_targets (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','dialing','answered','no_answer','busy','failed','done','do_not_call')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_call_id uuid references public.calls(id) on delete set null,
  payload jsonb default '{}'::jsonb,
  unique (campaign_id, contact_id)
);

-- Backfill agent_handles depuis les agents v1 existants
insert into public.agent_handles (org_id, kind, ai_agent_id, display_name)
select a.org_id, 'ai', a.id, a.name
from public.agents a
where not exists (select 1 from public.agent_handles h where h.ai_agent_id = a.id);

-- ─── GRANTs ────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ─── Cleanup éventuel du marker de test ───────────────────────────────────
drop table if exists public.axon_test_marker;

select 'DONE - 17 v2 tables ready' as status;
