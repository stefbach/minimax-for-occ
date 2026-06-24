-- 0036_agent_purpose.sql
--
-- Introduce a second class of AI agent: "management" agents that run
-- automations (email/WhatsApp follow-ups, row updates) instead of speaking on
-- calls. Telephony agents are unchanged — the column defaults to 'telephony'
-- so every existing production agent keeps its exact current behaviour.
--
-- Safety: management agents are NOT given a callable agent_handle (see
-- /api/agents POST), so they are invisible to campaign pickers and the
-- LiveKit voice worker never loads them. Nothing dials a management agent.

alter table public.agents
  add column if not exists purpose text not null default 'telephony';

-- Constrain to the known values. Existing rows are all 'telephony' (default),
-- so the check is satisfied on add.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_purpose_check'
  ) then
    alter table public.agents
      add constraint agents_purpose_check
      check (purpose in ('telephony', 'management'));
  end if;
end$$;

create index if not exists idx_agents_purpose on public.agents (purpose);

comment on column public.agents.purpose is
  'telephony = parle au téléphone (campagnes) ; management = exécute des automations (workflows). Défaut telephony pour ne rien changer aux agents existants.';
