-- =========================================================================
--  Axon — migration 0012 — Billing plans + usage tracking
--
--  Adds:
--    · public.plans       — catalog of subscription tiers
--    · public.usage_events — per-event usage rows (Twilio minutes,
--                             OpenAI tokens, MiniMax TTS chars, Deepgram
--                             STT minutes, …)
--    · organizations.plan_slug / stripe_* / subscription_status columns
--    · public.org_usage_monthly view — aggregated monthly totals per org
--
--  Stripe is wired in skeleton mode (columns + webhook hook), no live
--  integration is required for this migration to apply.
-- =========================================================================

-- ── plans (catalog) ────────────────────────────────────────────────────────
create table if not exists public.plans (
  id                    uuid primary key default uuid_generate_v4(),
  slug                  text not null unique,
  name                  text not null,
  monthly_price_cents   int  not null,
  included_minutes      int  default 0,        -- call minutes (Twilio)
  included_llm_tokens   int  default 0,        -- OpenAI tokens
  included_tts_chars    int  default 0,        -- MiniMax TTS chars
  included_stt_minutes  int  default 0,        -- Deepgram STT minutes
  stripe_price_id       text,
  created_at            timestamptz not null default now()
);

insert into public.plans
  (slug, name, monthly_price_cents, included_minutes, included_llm_tokens, included_tts_chars, included_stt_minutes)
values
  ('starter',    'Starter',     4900,    500,    500000,   100000,    500),
  ('pro',        'Pro',        19900,   3000,   5000000,  1000000,   3000),
  ('enterprise', 'Enterprise', 99900,  30000,  50000000, 10000000,  30000)
on conflict (slug) do nothing;

-- ── org subscription columns ──────────────────────────────────────────────
alter table public.organizations
  add column if not exists plan_slug              text default 'starter',
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status    text default 'active';

-- ── usage_events (per-event metering) ─────────────────────────────────────
create table if not exists public.usage_events (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  event_type  text not null,        -- 'call_minutes' | 'llm_tokens' | 'tts_chars' | 'stt_minutes' | …
  quantity    numeric not null default 0,
  cost_cents  int default 0,
  metadata    jsonb default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists usage_events_org_month_idx
  on public.usage_events (org_id, occurred_at desc);
create index if not exists usage_events_org_type_idx
  on public.usage_events (org_id, event_type, occurred_at desc);

-- ── aggregated monthly view ───────────────────────────────────────────────
create or replace view public.org_usage_monthly as
select
  org_id,
  date_trunc('month', occurred_at) as month,
  event_type,
  sum(quantity)   as total_quantity,
  sum(cost_cents) as total_cost_cents,
  count(*)        as event_count
from public.usage_events
group by org_id, date_trunc('month', occurred_at), event_type;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.plans         enable row level security;
alter table public.usage_events  enable row level security;

-- plans: catalog is world-readable to authenticated users
drop policy if exists plans_select_all on public.plans;
create policy plans_select_all on public.plans
  for select using ( auth.role() = 'authenticated' );

-- usage_events: members of the org can read their own usage
drop policy if exists usage_events_select_org on public.usage_events;
create policy usage_events_select_org on public.usage_events
  for select using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

-- writes are service-role only (no insert/update/delete policy for end-users)

-- Grant select on the view so /api/billing/usage can read it through the
-- service-role client. End-user reads still go through usage_events RLS.
grant select on public.org_usage_monthly to anon, authenticated, service_role;
grant select on public.plans              to anon, authenticated, service_role;
