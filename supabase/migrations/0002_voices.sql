-- Voice Studio: catalog of available MiniMax voices (cloned + presets).

create table if not exists public.voices (
  id              uuid primary key default uuid_generate_v4(),
  voice_id        text not null unique,
  display_name    text not null,
  language        text default 'multi',                 -- 'multi'|'fr'|'en'|...
  source          text not null default 'cloned',       -- 'cloned' | 'preset'
  description     text,
  sample_text     text default 'Bonjour, je suis votre nouvel assistant vocal.',
  metadata        jsonb default '{}'::jsonb,            -- e.g. minimax file_id, sample url
  created_at      timestamptz not null default now()
);

create index if not exists idx_voices_source on public.voices (source);

alter table public.voices enable row level security;
drop policy if exists "open_all_voices" on public.voices;
create policy "open_all_voices" on public.voices for all using (true) with check (true);

-- Seed a few well-known MiniMax preset voices so the dropdown is never empty.
insert into public.voices (voice_id, display_name, language, source, description)
values
  ('male-qn-qingse',    'Voice — Male (FR/EN, neutre)', 'multi', 'preset', 'Voix masculine MiniMax preset, ton neutre'),
  ('female-shaonv',     'Voice — Female (FR/EN, jeune)','multi','preset',  'Voix féminine MiniMax preset, ton jeune'),
  ('female-yujie',      'Voice — Female (FR/EN, mature)','multi','preset','Voix féminine MiniMax preset, ton mature'),
  ('male-qn-jingying',  'Voice — Male (FR/EN, sérieux)','multi','preset', 'Voix masculine MiniMax preset, ton sérieux')
on conflict (voice_id) do nothing;
