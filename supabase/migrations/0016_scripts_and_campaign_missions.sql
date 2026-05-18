-- Phase 4: smart campaigns with reusable scripts + live prospect timeline.
--
-- - `scripts` and `script_versions` provide versioned playbooks an org can
--   reuse across campaigns (qualification, closing, callback, sav, …).
-- - `campaigns` gains `mission`, `script_id`, `agent_team_id` so a campaign
--   can declare its intent and which team / script it leans on.  The
--   `agent_team_id` column purposely has NO FK so this migration stays
--   compatible with deployments where phase 3 (agent teams) has not landed.
-- - `contact_interactions` records the live timeline displayed on the
--   prospect sheet of the human softphone.
--
-- All new tables are org-scoped and protected by RLS using the existing
-- `is_member_of(org)` helper (introduced in 0008).

create table if not exists public.scripts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  mission text,                       -- qualification | closing | rappel | sav | …
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_scripts_org on public.scripts(org_id, created_at desc);

create table if not exists public.script_versions (
  id uuid primary key default uuid_generate_v4(),
  script_id uuid not null references public.scripts(id) on delete cascade,
  version int not null,
  steps jsonb not null,               -- [{ step, title, content, branches: [...] }]
  created_by uuid,
  created_at timestamptz not null default now(),
  note text,
  unique (script_id, version)
);

create index if not exists idx_script_versions_script on public.script_versions(script_id, version desc);

alter table public.scripts enable row level security;
alter table public.script_versions enable row level security;

drop policy if exists "scripts_org" on public.scripts;
create policy "scripts_org" on public.scripts
  for all
  using (is_member_of(org_id))
  with check (is_member_of(org_id));

drop policy if exists "script_versions_via_script" on public.script_versions;
create policy "script_versions_via_script" on public.script_versions
  for all
  using (
    exists (
      select 1 from public.scripts s
      where s.id = script_versions.script_id
        and is_member_of(s.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.scripts s
      where s.id = script_versions.script_id
        and is_member_of(s.org_id)
    )
  );

-- Enrichissement campaigns ------------------------------------------------
alter table public.campaigns add column if not exists mission text;
alter table public.campaigns
  add column if not exists script_id uuid references public.scripts(id) on delete set null;
-- agent_team_id has no FK on purpose: phase 3 may not be merged yet.
alter table public.campaigns add column if not exists agent_team_id uuid;

-- Timeline interactions par contact --------------------------------------
create table if not exists public.contact_interactions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  call_id uuid,
  kind text not null,                 -- call | note | email | sms | ai_summary | tag
  summary text,
  details jsonb,
  created_by uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_contact_interactions
  on public.contact_interactions(contact_id, occurred_at desc);
create index if not exists idx_contact_interactions_org
  on public.contact_interactions(org_id, occurred_at desc);

alter table public.contact_interactions enable row level security;

drop policy if exists "ci_org" on public.contact_interactions;
create policy "ci_org" on public.contact_interactions
  for all
  using (is_member_of(org_id))
  with check (is_member_of(org_id));
