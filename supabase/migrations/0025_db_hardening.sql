-- ====================================================================
--  Sprint 3 — Database hardening
--  --------------------------------------------------------------------
--  · Adds missing covering indexes on hot read paths (org-scoped lists)
--  · Backfills updated_at columns on state tables that lacked them
--  · Installs a generic updated_at trigger and wires it to those tables
-- ====================================================================

-- ─── 1. Hot-path indexes ────────────────────────────────────────────
create index if not exists idx_conversations_org_created
  on public.conversations (org_id, created_at desc);

create index if not exists idx_contacts_org_created
  on public.contacts (org_id, created_at desc);

create index if not exists idx_human_presence_org
  on public.human_presence (org_id);

create index if not exists idx_agent_handles_org_active
  on public.agent_handles (org_id, active);

create index if not exists idx_invitations_org_created
  on public.invitations (org_id, created_at desc);

create index if not exists idx_scripts_org_created
  on public.scripts (org_id, created_at desc);

-- ─── 2. updated_at columns on state tables ──────────────────────────
alter table public.flow_steps     add column if not exists updated_at timestamptz not null default now();
alter table public.flow_edges     add column if not exists updated_at timestamptz not null default now();
alter table public.scripts        add column if not exists updated_at timestamptz not null default now();
alter table public.agent_handles  add column if not exists updated_at timestamptz not null default now();
alter table public.human_presence add column if not exists updated_at timestamptz not null default now();

-- ─── 3. Generic updated_at trigger function ─────────────────────────
create or replace function public._set_updated_at_trigger()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_flow_steps_updated_at on public.flow_steps;
create trigger trg_flow_steps_updated_at
  before update on public.flow_steps
  for each row execute function public._set_updated_at_trigger();

drop trigger if exists trg_flow_edges_updated_at on public.flow_edges;
create trigger trg_flow_edges_updated_at
  before update on public.flow_edges
  for each row execute function public._set_updated_at_trigger();

drop trigger if exists trg_scripts_updated_at on public.scripts;
create trigger trg_scripts_updated_at
  before update on public.scripts
  for each row execute function public._set_updated_at_trigger();

drop trigger if exists trg_agent_handles_updated_at on public.agent_handles;
create trigger trg_agent_handles_updated_at
  before update on public.agent_handles
  for each row execute function public._set_updated_at_trigger();

drop trigger if exists trg_human_presence_updated_at on public.human_presence;
create trigger trg_human_presence_updated_at
  before update on public.human_presence
  for each row execute function public._set_updated_at_trigger();
