-- Phase 7 — Transcripts, analyses LLM configurables, alertes & hold music
--
-- Adds:
--   • call_transcripts        — 1 row per turn (speaker change)
--   • calls.summary           — LLM-generated synthesis (free text)
--   • analysis_policies       — configurable LLM analyses (prompt + JSON schema)
--   • call_analyses           — per-call results of each policy
--   • alert_rules             — rules that fire alerts from analysis results
--   • alerts                  — generated alerts, ack-able by managers
--   • organizations.hold_music_url — optional custom hold music

-- ── Transcripts ───────────────────────────────────────────────────────────
create table if not exists public.call_transcripts (
  id uuid primary key default uuid_generate_v4(),
  call_id uuid not null references public.calls(id) on delete cascade,
  seq int not null,
  speaker text not null,
  speaker_id text,
  text text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  confidence numeric,
  language text,
  created_at timestamptz not null default now()
);
create index if not exists idx_call_transcripts_call on public.call_transcripts(call_id, seq);
alter table public.call_transcripts enable row level security;
drop policy if exists "transcripts_via_call" on public.call_transcripts;
create policy "transcripts_via_call" on public.call_transcripts for all using (
  exists (select 1 from public.calls c where c.id = call_id and public.is_member_of(c.org_id))
);

-- ── Summary on calls ──────────────────────────────────────────────────────
alter table public.calls add column if not exists summary text;
alter table public.calls add column if not exists summary_generated_at timestamptz;

-- ── Analysis policies ─────────────────────────────────────────────────────
create table if not exists public.analysis_policies (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  prompt text not null,
  output_schema jsonb not null,
  scope text not null default 'all',                -- "all" | "campaign" | "queue"
  scope_id uuid,
  enabled boolean not null default true,
  model text default 'gpt-4o-mini',
  created_at timestamptz not null default now()
);
alter table public.analysis_policies enable row level security;
drop policy if exists "ap_org" on public.analysis_policies;
create policy "ap_org" on public.analysis_policies for all
  using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

-- ── Analysis results ──────────────────────────────────────────────────────
create table if not exists public.call_analyses (
  id uuid primary key default uuid_generate_v4(),
  call_id uuid not null references public.calls(id) on delete cascade,
  policy_id uuid not null references public.analysis_policies(id) on delete cascade,
  result jsonb not null,
  tokens_input int,
  tokens_output int,
  cost_cents int,
  created_at timestamptz not null default now(),
  unique (call_id, policy_id)
);
create index if not exists idx_call_analyses_call on public.call_analyses(call_id);
alter table public.call_analyses enable row level security;
drop policy if exists "ca_via_call" on public.call_analyses;
create policy "ca_via_call" on public.call_analyses for all using (
  exists (select 1 from public.calls c where c.id = call_id and public.is_member_of(c.org_id))
);

-- ── Alert rules ───────────────────────────────────────────────────────────
create table if not exists public.alert_rules (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  policy_id uuid references public.analysis_policies(id) on delete cascade,
  condition jsonb not null,                         -- e.g. {"path":"sentiment","op":"<","value":0.2}
  severity text not null default 'info',            -- "info" | "warn" | "critical"
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.alert_rules enable row level security;
drop policy if exists "ar_org" on public.alert_rules;
create policy "ar_org" on public.alert_rules for all
  using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

-- ── Alerts ────────────────────────────────────────────────────────────────
create table if not exists public.alerts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid references public.alert_rules(id) on delete set null,
  call_id uuid references public.calls(id) on delete cascade,
  severity text not null,
  message text not null,
  payload jsonb,
  acked boolean not null default false,
  acked_by uuid,
  acked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_alerts_org_unacked on public.alerts(org_id, created_at desc) where acked = false;
alter table public.alerts enable row level security;
drop policy if exists "al_org" on public.alerts;
create policy "al_org" on public.alerts for all
  using (public.is_member_of(org_id))
  with check (public.is_member_of(org_id));

-- ── Hold music ────────────────────────────────────────────────────────────
alter table public.organizations add column if not exists hold_music_url text;
