-- ============================================================================
--  Axon v2 — flows (IVR) + campaigns (outbound).
--  Lighter migration kept separate so the foundations (0006) can land first.
-- ============================================================================

-- Flow = an IVR / routing graph attached to a phone_number.
create table if not exists public.flows (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  start_step_id   uuid,                                       -- → flow_steps.id (NULL until first step added)
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_flows_org on public.flows (org_id);

-- Each step is a node in the IVR graph.
create table if not exists public.flow_steps (
  id              uuid primary key default uuid_generate_v4(),
  flow_id         uuid not null references public.flows(id) on delete cascade,
  kind            text not null check (kind in (
    'welcome',     -- play a TTS / audio file
    'menu_dtmf',   -- collect a DTMF press, branch via flow_edges
    'gather_speech', -- listen for short voice input (intent), branch via flow_edges
    'ai_agent',    -- hand the call to an AI agent (links to agent_handles)
    'transfer',    -- transfer to a phone number or SIP URI
    'route_queue', -- send into a queue
    'voicemail',   -- record then notify
    'hangup'       -- end the call
  )),
  label           text,
  config          jsonb not null default '{}'::jsonb,         -- step-specific (text, agent_handle_id, queue_id, audio_url, ...)
  position        jsonb default '{}'::jsonb,                  -- canvas {x,y} for the visual editor
  created_at      timestamptz not null default now()
);

create index if not exists idx_flow_steps_flow on public.flow_steps (flow_id);

alter table public.flows
  add constraint flows_start_step_fk
  foreign key (start_step_id) references public.flow_steps(id) on delete set null
  deferrable initially deferred;

-- Directed edge between two steps. `condition` lets DTMF / intent / fallback dispatch.
create table if not exists public.flow_edges (
  id              uuid primary key default uuid_generate_v4(),
  flow_id         uuid not null references public.flows(id) on delete cascade,
  from_step_id    uuid not null references public.flow_steps(id) on delete cascade,
  to_step_id      uuid not null references public.flow_steps(id) on delete cascade,
  condition       jsonb not null default '{"kind":"always"}'::jsonb,
  -- e.g. {"kind":"dtmf","key":"1"}  {"kind":"intent","value":"reservation"}  {"kind":"fallback"}
  position        int not null default 0,                     -- order when multiple match
  created_at      timestamptz not null default now()
);

create index if not exists idx_flow_edges_from on public.flow_edges (from_step_id);

-- Wire phone_numbers.flow_id → flows.id (FK was deferred from 0006).
alter table public.phone_numbers
  add constraint phone_numbers_flow_fk
  foreign key (flow_id) references public.flows(id) on delete set null;

-- ─── Campaigns (outbound) ──────────────────────────────────────────────────
create table if not exists public.campaigns (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  agent_handle_id uuid not null references public.agent_handles(id) on delete restrict,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  caller_id_e164  text,                                       -- explicit override, else use phone_number.e164
  state           text not null default 'draft' check (
    state in ('draft','scheduled','running','paused','completed','cancelled')
  ),
  schedule        jsonb default '{}'::jsonb,                  -- {"start_at": "...", "days": ["mon",...], "hours": [9,18]}
  max_concurrency int not null default 5,
  max_attempts    int not null default 3,
  retry_delay_min int not null default 60,
  amd_enabled     boolean not null default true,              -- answering machine detection
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_campaigns_org_state on public.campaigns (org_id, state);

-- Each contact targeted by a campaign — many rows per campaign.
create table if not exists public.campaign_targets (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id)  on delete cascade,
  status          text not null default 'pending' check (
    status in ('pending','dialing','answered','no_answer','busy','failed','done','do_not_call')
  ),
  attempts        int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_call_id    uuid references public.calls(id) on delete set null,
  payload         jsonb default '{}'::jsonb,                  -- per-target variables for the AI script
  unique (campaign_id, contact_id)
);

create index if not exists idx_campaign_targets_due
  on public.campaign_targets (campaign_id, status, next_attempt_at);

-- ─── RLS (same pattern as 0006) ─────────────────────────────────────────────
alter table public.flows           enable row level security;
alter table public.flow_steps      enable row level security;
alter table public.flow_edges      enable row level security;
alter table public.campaigns       enable row level security;
alter table public.campaign_targets enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['flows','campaigns'])
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

-- flow_steps / flow_edges scoped via parent flow.
drop policy if exists "flow_steps_via_flow" on public.flow_steps;
create policy "flow_steps_via_flow" on public.flow_steps
  for all using (
    exists (select 1 from public.flows f where f.id = flow_id and public.is_member_of(f.org_id))
  )
  with check (
    exists (select 1 from public.flows f where f.id = flow_id and public.is_member_of(f.org_id))
  );

drop policy if exists "flow_edges_via_flow" on public.flow_edges;
create policy "flow_edges_via_flow" on public.flow_edges
  for all using (
    exists (select 1 from public.flows f where f.id = flow_id and public.is_member_of(f.org_id))
  )
  with check (
    exists (select 1 from public.flows f where f.id = flow_id and public.is_member_of(f.org_id))
  );

-- campaign_targets scoped via parent campaign.
drop policy if exists "campaign_targets_via_campaign" on public.campaign_targets;
create policy "campaign_targets_via_campaign" on public.campaign_targets
  for all using (
    exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_member_of(c.org_id))
  )
  with check (
    exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_member_of(c.org_id))
  );

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
