-- =========================================================================
--  Axon V2 — admin/client split foundation
--
--  Adds:
--    1. New canonical roles (owner, builder, analyst, viewer) — additive,
--       no CHECK constraint so existing rows keep working.
--    2. audit_log table — records sensitive actions (per-org). Surfaced
--       live on the Axon super_admin dashboard.
--    3. organizations.status enum (active|suspended|archived|pending_deletion)
--       + deletion_scheduled_at. Replaces the binary `active` flag with a
--       proper soft-delete state machine:
--         active             → normal
--         suspended          → login blocked, data preserved, billing on
--         archived           → read-only, no billing
--         pending_deletion   → 30-day grace, then hard delete
--       The legacy `active` column stays so older code keeps reading it
--       (true when status='active').
-- =========================================================================

-- ─── 1. Document the expanded role catalog ───────────────────────────────
comment on column public.memberships.role is
  'super_admin | axon_support | axon_billing | axon_engineer  (Axon team)
   | owner | manager | supervisor | builder | agent | analyst | viewer  (client team)
   — see web/components/AdminSidebar.tsx / ClientSidebar.tsx for permission gates.';

-- ─── 2. Audit log ────────────────────────────────────────────────────────
-- One row per sensitive action, scoped by org. RLS lets super_admins read
-- everything (Axon dashboard) and lets each org's members read their own
-- org's log (manager-level audit panel in client app, later).
create table if not exists public.audit_log (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  org_id          uuid references public.organizations(id) on delete cascade,
  actor_user_id   uuid,                                        -- auth.users.id, may be null for system actions
  actor_role      text,                                        -- snapshot at action time
  action          text not null,                               -- e.g. 'org.created', 'campaign.launched', 'voice.deleted', 'user.invited', 'recording.listened'
  resource_type   text,                                        -- 'campaign', 'agent', 'voice', 'membership', ...
  resource_id     text,                                        -- uuid or business id
  metadata        jsonb not null default '{}'::jsonb,          -- arbitrary context (diff, target, etc.)
  ip_address      inet,
  user_agent      text
);

create index if not exists idx_audit_log_org_created  on public.audit_log (org_id, created_at desc);
create index if not exists idx_audit_log_actor        on public.audit_log (actor_user_id, created_at desc);
create index if not exists idx_audit_log_action       on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

-- Super_admins read all rows. Members read their own org's rows.
drop policy if exists "audit_log_super_admin_read"  on public.audit_log;
drop policy if exists "audit_log_org_member_read"   on public.audit_log;
drop policy if exists "audit_log_service_insert"    on public.audit_log;

create policy "audit_log_super_admin_read" on public.audit_log
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.role = 'super_admin'
    )
  );

create policy "audit_log_org_member_read" on public.audit_log
  for select
  using (org_id is not null and public.is_member_of(org_id));

-- Inserts only via service_role (the API records audit events from server-side
-- routes, never directly from the browser).
create policy "audit_log_service_insert" on public.audit_log
  for insert
  with check (false);

grant select on public.audit_log to authenticated;
grant all    on public.audit_log to service_role;
grant usage, select on sequence audit_log_id_seq to service_role;

-- ─── 3. Organization lifecycle status ────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'status'
  ) then
    alter table public.organizations
      add column status text not null default 'active'
        check (status in ('active','suspended','archived','pending_deletion'));
  end if;
end$$;

alter table public.organizations
  add column if not exists deletion_scheduled_at timestamptz;

create index if not exists idx_organizations_status on public.organizations (status);

-- Backfill: existing inactive orgs become 'suspended'; the rest stay 'active'.
update public.organizations
  set status = case when active is false then 'suspended' else 'active' end
  where status = 'active' and active is false;

-- Keep the legacy `active` flag in sync via a trigger so older code that
-- still reads `organizations.active` (e.g. the dialer) keeps working without
-- changes during the migration window.
create or replace function public.sync_organization_active_flag()
returns trigger language plpgsql as $$
begin
  new.active := (new.status = 'active');
  return new;
end$$;

drop trigger if exists trg_sync_organization_active on public.organizations;
create trigger trg_sync_organization_active
  before insert or update of status on public.organizations
  for each row execute function public.sync_organization_active_flag();

comment on column public.organizations.status is
  'active | suspended | archived | pending_deletion. Drives auth gating and billing.';
comment on column public.organizations.deletion_scheduled_at is
  'When status=pending_deletion, the timestamp at which a cron will hard-delete the org. 30-day RGPD grace.';
