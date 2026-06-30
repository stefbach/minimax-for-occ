-- Inbound number → human agent assignment (Wati 25/06).
--
-- Two additions:
--
--  1. phone_numbers.human_first_enabled (boolean, default false)
--     Per-number toggle: when ON, the AI worker rings an ONLINE human first
--     before answering. Controlled from the Numbers page (NumbersClient.tsx).
--
--  2. inbound_number_agents table
--     Which human users are assigned to receive inbound calls on each number.
--     The "human-first" worker (agent/human_first.py) uses this to pick the
--     longest-idle available agent to ring. When no one is available the AI
--     answers directly.
--
-- Companion code: agent/human_first.py, web/components/numbers/NumbersClient.tsx,
-- web/app/api/team/members/[user_id]/numbers/route.ts.

-- 1. Per-number toggle ----------------------------------------------------------
alter table public.phone_numbers
  add column if not exists human_first_enabled boolean not null default false;

-- 2. Assignment table -----------------------------------------------------------
create table if not exists public.inbound_number_agents (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid not null,
  phone_number_id  uuid not null references public.phone_numbers(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (org_id, phone_number_id, user_id)
);

create index if not exists idx_inbound_number_agents_org_phone
  on public.inbound_number_agents (org_id, phone_number_id);

create index if not exists idx_inbound_number_agents_org_user
  on public.inbound_number_agents (org_id, user_id);

-- No RLS: accessed only via the service-role admin client behind authenticated,
-- role-gated API routes (same pattern as outbound_number_agents).
alter table public.inbound_number_agents disable row level security;
