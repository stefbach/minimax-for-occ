-- Per-agent OUTBOUND caller-ID assignment (Wati 25/06).
--
-- Mirrors inbound_number_agents but for the From / caller-ID a human agent may
-- use when placing OUTBOUND calls from the softphone. The point: managers
-- assign specific numbers to specific agents so they can't dial out on every
-- org number. Restriction is enforced server-side in:
--   * /api/desk/dial            (LiveKit SIP / Twilio REST path)
--   * /api/twilio/voice-outbound (browser Twilio Voice SDK path)
--   * /api/desk/caller-id        (what the softphone offers as caller-ID)
--
-- When an agent has NO row here, the call falls back to the org default
-- (geo-routing) — Wati's chosen behaviour. `is_primary` marks the agent's
-- default caller-ID; an agent may have several assigned numbers and pick one.
create table if not exists public.outbound_number_agents (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null,
  phone_number_id uuid not null,
  user_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, phone_number_id)
);

create index if not exists idx_outbound_number_agents_org_user
  on public.outbound_number_agents (org_id, user_id);
create index if not exists idx_outbound_number_agents_org_phone
  on public.outbound_number_agents (org_id, phone_number_id);

-- At most ONE primary (default) number per agent.
create unique index if not exists uq_outbound_number_agents_primary
  on public.outbound_number_agents (org_id, user_id)
  where is_primary;

-- Match inbound_number_agents: no RLS, accessed only via the service-role
-- admin client behind authenticated, role-gated API routes.
alter table public.outbound_number_agents disable row level security;
