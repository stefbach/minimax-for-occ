-- ====================================================================
--  copilot_actions : audit log for Super Admin Copilot tool calls
--  --------------------------------------------------------------------
--  Every write-tool invocation issued by the AI Copilot is staged as a
--  pending row. The user explicitly confirms in the UI before the row is
--  flipped to executed (and the tool actually runs). Read-only tools are
--  executed straight away and audited as executed at insert time.
-- ====================================================================

create table if not exists public.copilot_actions (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid references public.organizations(id) on delete set null,
  user_id      uuid not null,
  tool_name    text not null,                  -- e.g. "n8n.create_workflow", "supabase.run_sql"
  arguments    jsonb not null,
  result       jsonb,
  status       text not null default 'pending',-- pending | confirmed | executed | failed | rejected
  error        text,
  created_at   timestamptz not null default now(),
  executed_at  timestamptz
);

create index if not exists idx_copilot_actions_user
  on public.copilot_actions (user_id, created_at desc);

create index if not exists idx_copilot_actions_status
  on public.copilot_actions (status, created_at desc);

alter table public.copilot_actions enable row level security;

-- Only super_admin can see / touch copilot audit rows. Service role bypasses RLS,
-- so the route handlers can still write on behalf of the user.
drop policy if exists "copilot_super_only" on public.copilot_actions;
create policy "copilot_super_only"
  on public.copilot_actions
  for all
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.role = 'super_admin'
    )
  );
