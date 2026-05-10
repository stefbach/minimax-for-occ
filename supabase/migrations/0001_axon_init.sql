-- Axon Voice Agent Platform — initial schema
-- Apply via Supabase SQL editor or `supabase db push`.

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ====================================================================
--  agents : one row per voice agent persona
-- ====================================================================
create table if not exists public.agents (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  description     text,
  language        text not null default 'multi',           -- 'multi' | 'fr' | 'en' | ...
  llm_provider    text not null default 'openai',          -- 'openai' | 'anthropic' | 'minimax'
  llm_model       text not null default 'gpt-4o',
  tts_voice_id    text,                                    -- MiniMax voice id (cloned or preset)
  tts_emotion     text,
  tts_speed       real default 1.0,
  system_prompt   text not null default '',
  greeting        text default 'Bonjour, je vous écoute.',
  rag_enabled     boolean not null default false,
  rag_top_k       int default 4,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_agents_name on public.agents (lower(name));

-- ====================================================================
--  agent_n8n_workflows : which n8n workflows each agent can trigger
-- ====================================================================
create table if not exists public.agent_n8n_workflows (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  workflow_id     text not null,                           -- n8n workflow id (string)
  workflow_name   text not null,
  webhook_path    text not null,                           -- e.g. "voice-agent/book-appointment"
  description     text,                                    -- shown to LLM as tool description
  payload_schema  jsonb default '{}'::jsonb,               -- optional JSON Schema hint
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (agent_id, webhook_path)
);

create index if not exists idx_agent_n8n_agent_id on public.agent_n8n_workflows (agent_id);

-- ====================================================================
--  documents : RAG corpus, chunked and embedded with text-embedding-3-small (1536 dim)
-- ====================================================================
create table if not exists public.documents (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  source_name     text not null,                           -- filename, URL, etc.
  chunk_index     int not null default 0,
  content         text not null,
  embedding       vector(1536),
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_documents_agent_id on public.documents (agent_id);

-- HNSW index for cosine similarity search (Supabase / pgvector).
create index if not exists idx_documents_embedding_hnsw
  on public.documents
  using hnsw (embedding vector_cosine_ops);

-- ====================================================================
--  agent_runs : history of voice/chat sessions for observability
-- ====================================================================
create table if not exists public.agent_runs (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid references public.agents(id) on delete set null,
  room_id         text,
  channel         text not null default 'web',             -- 'web' | 'tel' | 'chat'
  transcript      jsonb default '[]'::jsonb,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

create index if not exists idx_agent_runs_agent_id on public.agent_runs (agent_id, started_at desc);

-- ====================================================================
--  Helper RPC : match_documents — cosine kNN with agent scoping
-- ====================================================================
create or replace function public.match_documents(
  agent uuid,
  query_embedding vector(1536),
  match_count int default 4,
  similarity_threshold real default 0.0
)
returns table (
  id uuid,
  source_name text,
  chunk_index int,
  content text,
  similarity real
)
language sql
stable
as $$
  select
    d.id,
    d.source_name,
    d.chunk_index,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.agent_id = agent
    and d.embedding is not null
    and 1 - (d.embedding <=> query_embedding) >= similarity_threshold
  order by d.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- ====================================================================
--  updated_at trigger on agents
-- ====================================================================
create or replace function public._set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_agents_updated_at on public.agents;
create trigger trg_agents_updated_at
before update on public.agents
for each row execute function public._set_updated_at();

-- ====================================================================
--  RLS — for now everything is open (single-tenant, no auth UI yet).
--  When auth lands, replace with per-organization policies.
-- ====================================================================
alter table public.agents              enable row level security;
alter table public.agent_n8n_workflows enable row level security;
alter table public.documents           enable row level security;
alter table public.agent_runs          enable row level security;

drop policy if exists "open_all_agents"     on public.agents;
drop policy if exists "open_all_n8n"        on public.agent_n8n_workflows;
drop policy if exists "open_all_documents"  on public.documents;
drop policy if exists "open_all_runs"       on public.agent_runs;

create policy "open_all_agents"     on public.agents              for all using (true) with check (true);
create policy "open_all_n8n"        on public.agent_n8n_workflows for all using (true) with check (true);
create policy "open_all_documents"  on public.documents           for all using (true) with check (true);
create policy "open_all_runs"       on public.agent_runs          for all using (true) with check (true);
