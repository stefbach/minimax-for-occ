-- ============================================================================
--  Phase 1 — Billing usage events (per-org metering)
--  - Tracks raw usage events emitted by the platform (call minutes, LLM
--    tokens, TTS chars, STT minutes, etc.) with per-event cost in cents.
--  - RLS: org members read their own events; service_role bypasses RLS for
--    ingest / aggregation jobs.
-- ============================================================================

create extension if not exists "uuid-ossp";

create table if not exists public.usage_events (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  event_type  text not null,           -- call_minute, llm_tokens, tts_chars, stt_minutes, etc.
  quantity    numeric not null,
  cost_cents  int default 0,
  metadata    jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_usage_events_org_time
  on public.usage_events (org_id, occurred_at desc);

alter table public.usage_events enable row level security;

-- Org members can read their own usage. Writes are restricted to service_role
-- (the ingest worker / API routes using the service role key); the policy
-- below intentionally does not grant insert/update to authenticated users.
drop policy if exists "org_usage_select" on public.usage_events;
create policy "org_usage_select" on public.usage_events
  for select using (public.is_member_of(org_id));

-- GRANTs are already covered by the blanket grants in 0006; this is defensive
-- in case the table was created later.
grant select on public.usage_events to authenticated, service_role;
grant all    on public.usage_events to service_role;
