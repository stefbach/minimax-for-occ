-- 0037_agent_workflows.sql
--
-- Phase 2 of management agents: let a native workflow be powered by a
-- management agent. The agent becomes the "brain" of AI steps — it drafts the
-- email/WhatsApp/row-update content per matching row from its directives.
--
-- Additive only: existing workflows have agent_id NULL and approval_mode
-- 'auto', so their static steps keep running exactly as before.

alter table public.org_workflows
  add column if not exists agent_id uuid references public.agents(id) on delete set null;

-- 'auto'   : AI steps draft AND send immediately (like the static steps).
-- 'review' : AI steps enqueue a pending action for human approval before send.
alter table public.org_workflows
  add column if not exists approval_mode text not null default 'auto';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_workflows_approval_mode_check') then
    alter table public.org_workflows
      add constraint org_workflows_approval_mode_check
      check (approval_mode in ('auto', 'review'));
  end if;
end$$;

-- Approval queue: in 'review' mode each AI step writes a drafted action here
-- instead of sending. The approval UI lists pending rows; approving sends via
-- the same executors and marks the source row; rejecting drops it.
create table if not exists public.org_workflow_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.org_workflows(id) on delete cascade,
  run_id      uuid references public.org_workflow_runs(id) on delete set null,
  agent_id    uuid references public.agents(id) on delete set null,
  -- 'email' | 'whatsapp' | 'update_row'
  channel     text not null,
  table_name  text not null,
  row_id      text not null,
  -- Channel-specific drafted payload, ready to execute on approval:
  --  email      : { credential_id, to, subject, html, mark_column }
  --  whatsapp   : { credential_id, phone, template_name, broadcast_prefix,
  --                 parameters:[{name,value}], mark_column }
  --  update_row : { set: {col: value} }
  payload     jsonb not null default '{}'::jsonb,
  -- 'pending' | 'sent' | 'rejected' | 'failed'
  status      text not null default 'pending',
  error       text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid
);

create index if not exists org_workflow_actions_queue_idx
  on public.org_workflow_actions (org_id, status, created_at desc);
create index if not exists org_workflow_actions_wf_idx
  on public.org_workflow_actions (workflow_id, created_at desc);

alter table public.org_workflow_actions enable row level security;
drop policy if exists org_workflow_actions_select_members on public.org_workflow_actions;
create policy org_workflow_actions_select_members on public.org_workflow_actions
  for select to authenticated
  using (org_id in (select org_id from public.memberships where user_id = auth.uid()));
-- Writes (enqueue / decide) happen via service-role API routes only.
