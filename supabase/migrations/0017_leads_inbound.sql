-- ============================================================================
--  Phase 5 — Inbound lead connectors.
--
--  Goal: receive leads from external sources (Google Ads Lead Form Extensions,
--  Facebook Lead Ads, Google Sheets / CSV imports) via signed n8n webhooks
--  hitting POST /api/leads/inbound. Each connector is identified by a row in
--  `inbound_webhook_secrets` (one per org, optionally tied to a default
--  campaign).
--
--  Leads less than `campaigns.speed_to_lead_secs` old are inserted with
--  priority 0 (top of the dialer queue); older leads keep the default
--  priority 5.
-- ============================================================================

alter table public.campaigns
  add column if not exists speed_to_lead_secs int not null default 60;

alter table public.campaign_targets
  add column if not exists priority int not null default 5;   -- 0 = top, 5 = normal

alter table public.campaign_targets
  add column if not exists source text;                       -- "csv", "google_ads", "facebook_ads", "n8n", ...

alter table public.campaign_targets
  add column if not exists source_metadata jsonb;

-- Composite index for the dialer worker: cheap "what should I dial next?"
-- ordering by priority then by next_attempt_at on pending/retryable targets.
-- The existing schema uses `status` with values
-- ('pending','dialing','answered','no_answer','busy','failed','done','do_not_call'),
-- so we filter on the pending-ish ones.
create index if not exists idx_campaign_targets_priority
  on public.campaign_targets (campaign_id, priority asc, next_attempt_at asc nulls first)
  where status in ('pending', 'no_answer', 'busy');

-- ─── Inbound webhook secrets (one row per connector) ──────────────────────
create table if not exists public.inbound_webhook_secrets (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  secret          text not null,
  campaign_id     uuid references public.campaigns(id) on delete set null,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_iws_org      on public.inbound_webhook_secrets (org_id);
create index if not exists idx_iws_secret   on public.inbound_webhook_secrets (secret);

alter table public.inbound_webhook_secrets enable row level security;

drop policy if exists "iws_org" on public.inbound_webhook_secrets;
create policy "iws_org" on public.inbound_webhook_secrets
  for all using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
