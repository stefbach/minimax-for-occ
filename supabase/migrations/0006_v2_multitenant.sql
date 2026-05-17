-- ============================================================================
--  Axon v2 — multi-tenant foundations
--  - Adds organizations + memberships (Supabase Auth-backed users).
--  - Backfills every v1 table with org_id pointing to a default "Legacy" org
--    so existing data keeps working.
--  - Adds strict RLS: users only see their own organizations.
--  - service_role keeps full access (bypasses RLS) for the Python worker
--    and server-side API routes.
--  - Adds the new contact-center primitives: phone_numbers, contacts,
--    conversations, calls, queues, queue_memberships, agents (unified),
--    event_log. (Flows + campaigns ship in 0007.)
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ─── organizations + memberships ───────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null,                                -- → auth.users.id
  role            text not null default 'admin',                 -- admin | supervisor | agent
  created_at      timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_memberships_user on public.memberships (user_id);
create index if not exists idx_memberships_org  on public.memberships (org_id);

-- Helper used in every RLS policy below.
create or replace function public.is_member_of(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_member_of(uuid) to anon, authenticated, service_role;

-- ─── Legacy org for backfilling existing v1 rows ───────────────────────────
insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Legacy', 'legacy')
on conflict (slug) do nothing;

-- ─── Add org_id to every v1 table (NULLABLE first, backfill, then NOT NULL) ─
alter table public.agents              add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.agent_n8n_workflows add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.documents           add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.agent_runs          add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.voices              add column if not exists org_id uuid references public.organizations(id) on delete cascade;

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

-- ─── New contact-center primitives ─────────────────────────────────────────

-- Phone numbers we manage (provisioned via Twilio).
create table if not exists public.phone_numbers (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  e164            text not null unique,
  label           text,
  provider        text not null default 'twilio',
  provider_sid    text,                                       -- Twilio SID
  flow_id         uuid,                                       -- → flows.id, FK added in 0007
  capabilities    jsonb default '{"voice":true,"sms":true}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_phone_numbers_org on public.phone_numbers (org_id);

-- Queues — skill-based routing target.
create table if not exists public.queues (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  strategy        text not null default 'longest_idle',       -- longest_idle | round_robin | broadcast
  max_wait_secs   int default 600,
  fallback_voicemail boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (org_id, name)
);

-- Unified agent (human OR ai). Humans link to auth.users via memberships.
create table if not exists public.agent_handles (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('ai','human')),
  -- when kind='ai':
  ai_agent_id     uuid references public.agents(id) on delete cascade,
  -- when kind='human':
  user_id         uuid,                                       -- → auth.users.id
  display_name    text not null,
  skills          text[] default '{}',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (
    (kind = 'ai'    and ai_agent_id is not null and user_id is null) or
    (kind = 'human' and user_id     is not null and ai_agent_id is null)
  )
);

create index if not exists idx_agent_handles_org on public.agent_handles (org_id);

-- Backfill: one handle per existing v1 agent.
insert into public.agent_handles (org_id, kind, ai_agent_id, display_name)
select a.org_id, 'ai', a.id, a.name
from public.agents a
where not exists (
  select 1 from public.agent_handles h where h.ai_agent_id = a.id
);

-- Many-to-many queue ↔ agent_handle.
create table if not exists public.queue_memberships (
  id              uuid primary key default uuid_generate_v4(),
  queue_id        uuid not null references public.queues(id) on delete cascade,
  agent_handle_id uuid not null references public.agent_handles(id) on delete cascade,
  priority        int not null default 1,                     -- lower = higher priority
  unique (queue_id, agent_handle_id)
);

-- Realtime presence for human agents.
create table if not exists public.human_presence (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null,
  status          text not null default 'offline',            -- offline | available | busy | away
  current_call_id uuid,                                       -- → calls.id, FK added later
  last_seen       timestamptz not null default now(),
  unique (org_id, user_id)
);

-- CRM contacts.
create table if not exists public.contacts (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  e164            text not null,
  display_name    text,
  email           text,
  tags            text[] default '{}',
  attributes      jsonb default '{}'::jsonb,                  -- custom fields
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, e164)
);

create index if not exists idx_contacts_org on public.contacts (org_id);

-- Conversation thread per contact (groups multiple calls / messages over time).
create table if not exists public.conversations (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  last_event_at   timestamptz not null default now(),
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- Calls: the central state-machine.
create table if not exists public.calls (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  direction       text not null check (direction in ('in','out')),
  state           text not null default 'queued' check (
    state in ('queued','ringing','ivr','in_progress','wrap_up','ended','failed')
  ),
  from_e164       text,
  to_e164         text,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  queue_id        uuid references public.queues(id)        on delete set null,
  agent_handle_id uuid references public.agent_handles(id) on delete set null,
  room_id         text,                                       -- LiveKit room
  twilio_call_sid text,
  started_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  duration_secs   int,
  recording_url   text,
  transcript_url  text,
  disposition     text,                                       -- resolved|transferred|abandoned|voicemail|failed
  metadata        jsonb default '{}'::jsonb
);

create index if not exists idx_calls_org           on public.calls (org_id, started_at desc);
create index if not exists idx_calls_state         on public.calls (org_id, state) where state in ('queued','ringing','in_progress');
create index if not exists idx_calls_conversation  on public.calls (conversation_id);
create index if not exists idx_calls_agent_handle  on public.calls (agent_handle_id);

-- Per-call timeline (transfer, hold, dtmf, handoff, etc.).
create table if not exists public.call_events (
  id              uuid primary key default uuid_generate_v4(),
  call_id         uuid not null references public.calls(id) on delete cascade,
  at              timestamptz not null default now(),
  kind            text not null,                              -- 'transfer','hold','mute','dtmf','handoff_ai_to_human',...
  by_user_id      uuid,
  payload         jsonb default '{}'::jsonb
);

create index if not exists idx_call_events_call on public.call_events (call_id, at);

-- Immutable audit log for everything that matters.
create table if not exists public.event_log (
  id              bigserial primary key,
  org_id          uuid references public.organizations(id) on delete set null,
  at              timestamptz not null default now(),
  actor_user_id   uuid,
  actor_kind      text not null default 'system',             -- 'user' | 'system' | 'agent_ai' | 'agent_human'
  entity          text not null,                              -- 'agent','queue','call',...
  entity_id       text,
  action          text not null,                              -- 'created','updated','deleted','transferred',...
  payload         jsonb default '{}'::jsonb
);

create index if not exists idx_event_log_org_at on public.event_log (org_id, at desc);

-- ─── RLS — strict per-org for authenticated users, full bypass for service_role ─

alter table public.organizations     enable row level security;
alter table public.memberships       enable row level security;
alter table public.phone_numbers     enable row level security;
alter table public.queues            enable row level security;
alter table public.agent_handles     enable row level security;
alter table public.queue_memberships enable row level security;
alter table public.human_presence    enable row level security;
alter table public.contacts          enable row level security;
alter table public.conversations     enable row level security;
alter table public.calls             enable row level security;
alter table public.call_events       enable row level security;
alter table public.event_log         enable row level security;

-- Drop the legacy v1 open policies — they let anyone read any org's data.
drop policy if exists "open_all_agents"     on public.agents;
drop policy if exists "open_all_n8n"        on public.agent_n8n_workflows;
drop policy if exists "open_all_documents"  on public.documents;
drop policy if exists "open_all_runs"       on public.agent_runs;
drop policy if exists "open_all_voices"     on public.voices;

-- Generic per-org policies. service_role bypasses RLS by default in Supabase.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'agents','agent_n8n_workflows','documents','agent_runs','voices',
      'phone_numbers','queues','agent_handles','queue_memberships',
      'human_presence','contacts','conversations','calls','call_events'
    ])
  loop
    execute format($f$
      drop policy if exists "org_member_select" on public.%I;
      drop policy if exists "org_member_modify" on public.%I;
      create policy "org_member_select" on public.%I
        for select using (public.is_member_of(org_id));
      create policy "org_member_modify" on public.%I
        for all using (public.is_member_of(org_id))
        with check (public.is_member_of(org_id));
    $f$, t, t, t, t);
  end loop;
end$$;

-- queue_memberships has no org_id directly — scope via the parent queue.
drop policy if exists "queue_memberships_via_queue" on public.queue_memberships;
create policy "queue_memberships_via_queue" on public.queue_memberships
  for all using (
    exists (
      select 1 from public.queues q
      where q.id = queue_id and public.is_member_of(q.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.queues q
      where q.id = queue_id and public.is_member_of(q.org_id)
    )
  );

-- call_events scoped via parent call.
drop policy if exists "call_events_via_call" on public.call_events;
create policy "call_events_via_call" on public.call_events
  for all using (
    exists (
      select 1 from public.calls c
      where c.id = call_id and public.is_member_of(c.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.calls c
      where c.id = call_id and public.is_member_of(c.org_id)
    )
  );

-- organizations: a user sees only orgs where they're a member.
drop policy if exists "org_self_select" on public.organizations;
create policy "org_self_select" on public.organizations
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = organizations.id and m.user_id = auth.uid()
    )
  );

-- memberships: a user sees only their own memberships.
drop policy if exists "memberships_self" on public.memberships;
create policy "memberships_self" on public.memberships
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- event_log: read by org members; insert by service_role only.
drop policy if exists "event_log_org_member_read" on public.event_log;
create policy "event_log_org_member_read" on public.event_log
  for select using (org_id is null or public.is_member_of(org_id));

-- ─── GRANTs (idempotent, also covers tables created above) ─────────────────
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
