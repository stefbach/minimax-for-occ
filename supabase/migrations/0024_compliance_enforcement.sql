-- 0024_compliance_enforcement.sql
--
-- Compliance enforcement primitives for TCPA / DNC (Do Not Call) lists.
--
-- Adds a per-org `dnc_lists` table holding E.164 numbers that must never be
-- dialed by this organization. Both the web /api/desk/dial route and the
-- dialer worker consult this table before placing outbound calls.

create extension if not exists "uuid-ossp";

create table if not exists public.dnc_lists (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  e164       text not null,
  reason     text,
  added_at   timestamptz not null default now(),
  added_by   uuid references auth.users(id) on delete set null,
  unique (org_id, e164)
);

create index if not exists idx_dnc_org_e164 on public.dnc_lists(org_id, e164);

alter table public.dnc_lists enable row level security;

drop policy if exists "dnc_org" on public.dnc_lists;
create policy "dnc_org" on public.dnc_lists
  for all
  using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

grant select, insert, update, delete on public.dnc_lists to authenticated;
grant all on public.dnc_lists to service_role;
