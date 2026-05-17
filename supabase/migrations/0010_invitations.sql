-- =========================================================================
--  Axon — invitations
--  Stores pending invitations to join an organization. Linked via a token in
--  the signup URL: /signup?token=<token>.
--  RLS is left open for now (service_role always bypasses it anyway, and
--  invitations are emitted/accepted exclusively through server-side routes).
-- =========================================================================

create extension if not exists "uuid-ossp";

create table if not exists public.invitations (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  role        text not null default 'agent',
  invited_by  uuid,
  token       text not null unique,
  accepted_at timestamptz,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  created_at  timestamptz not null default now()
);

create index if not exists idx_invitations_org   on public.invitations (org_id);
create index if not exists idx_invitations_token on public.invitations (token);
create index if not exists idx_invitations_email on public.invitations (email);

-- RLS open for now — server routes use service_role which bypasses RLS.
alter table public.invitations enable row level security;

drop policy if exists invitations_all on public.invitations;
create policy invitations_all on public.invitations
  for all
  using (true)
  with check (true);

grant all on public.invitations to anon, authenticated, service_role;

select 'DONE - invitations ready' as status;
