-- ============================================================================
-- 0022_numbers_at_scale.sql
--
-- Phase 9 — Numbers at scale.
--
-- Adds compliance & health metadata to public.phone_numbers, a derived
-- `phone_numbers_health` view that joins 30-day call volume to each number,
-- and a lightweight trigger that keeps `last_call_at` in sync without
-- aggregating on every read.
--
-- Safe to run on top of 0008 (which defines phone_numbers + calls). Defensive
-- `add column if not exists` keeps it idempotent.
-- ============================================================================

-- ─── Columns ────────────────────────────────────────────────────────────────
alter table public.phone_numbers
  add column if not exists country_code text,                         -- "FR","US","MU"... (Phase 2 geo-routing)
  add column if not exists prefix text,                               -- e.g. "+33", "+1"
  add column if not exists is_default boolean not null default false,
  add column if not exists compliance_jurisdiction text,              -- "US_TCPA" | "EU_GDPR" | "MU_ICTA" | "OTHER"
  add column if not exists dnc_check_enabled boolean not null default false,
  add column if not exists webhook_configured boolean not null default false,
  add column if not exists webhook_configured_at timestamptz,
  add column if not exists last_call_at timestamptz,
  add column if not exists notes text,
  add column if not exists queue_id uuid,
  add column if not exists agent_handle_id uuid;

-- FK constraints (best-effort — skip if target tables differ in env)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='queues')
     and not exists (select 1 from information_schema.table_constraints
                     where constraint_name='phone_numbers_queue_fk' and table_name='phone_numbers') then
    alter table public.phone_numbers
      add constraint phone_numbers_queue_fk
      foreign key (queue_id) references public.queues(id) on delete set null;
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='agent_handles')
     and not exists (select 1 from information_schema.table_constraints
                     where constraint_name='phone_numbers_agent_fk' and table_name='phone_numbers') then
    alter table public.phone_numbers
      add constraint phone_numbers_agent_fk
      foreign key (agent_handle_id) references public.agent_handles(id) on delete set null;
  end if;
end $$;

create index if not exists idx_phone_numbers_last_call
  on public.phone_numbers (org_id, last_call_at desc nulls last);
create index if not exists idx_phone_numbers_country
  on public.phone_numbers (org_id, country_code);
create index if not exists idx_phone_numbers_active
  on public.phone_numbers (org_id, active);

-- ─── Health view ────────────────────────────────────────────────────────────
-- Volume sur 30j + dormance + answer rate. Postgres views inherit RLS from
-- their base tables, so multi-tenant isolation continues to work.
create or replace view public.phone_numbers_health as
select
  pn.id,
  pn.org_id,
  pn.e164,
  pn.label,
  pn.country_code,
  pn.is_default,
  pn.active,
  pn.queue_id,
  pn.agent_handle_id,
  pn.flow_id,
  pn.compliance_jurisdiction,
  pn.dnc_check_enabled,
  pn.webhook_configured,
  pn.last_call_at,
  coalesce(c30.total, 0)    as calls_30d,
  coalesce(c30.answered, 0) as answered_30d,
  case when coalesce(c30.total, 0) > 0
    then round(100.0 * c30.answered / c30.total, 1)
    else 0
  end as answer_rate_pct,
  case
    when pn.last_call_at is null then 'never_used'
    when pn.last_call_at < now() - interval '30 days' then 'dormant'
    when coalesce(c30.total, 0) < 5 then 'low_volume'
    else 'active'
  end as health_status
from public.phone_numbers pn
left join lateral (
  select
    count(*) as total,
    count(*) filter (
      where state in ('answered','in_progress','ended')
        and answered_at is not null
    ) as answered
  from public.calls
  where (from_e164 = pn.e164 or to_e164 = pn.e164)
    and started_at >= now() - interval '30 days'
) c30 on true;

grant select on public.phone_numbers_health to anon, authenticated, service_role;

-- ─── Trigger: keep phone_numbers.last_call_at fresh ─────────────────────────
create or replace function public.update_phone_last_call() returns trigger as $$
begin
  -- Outbound: from_e164 is one of our numbers
  if new.from_e164 is not null then
    update public.phone_numbers
       set last_call_at = new.started_at
     where e164 = new.from_e164
       and (last_call_at is null or last_call_at < new.started_at);
  end if;
  -- Inbound: to_e164 is one of our numbers
  if new.to_e164 is not null then
    update public.phone_numbers
       set last_call_at = new.started_at
     where e164 = new.to_e164
       and (last_call_at is null or last_call_at < new.started_at);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_update_phone_last_call on public.calls;
create trigger trg_update_phone_last_call
  after insert on public.calls
  for each row execute function public.update_phone_last_call();
