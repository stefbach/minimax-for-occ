-- Migration: switch RAG embeddings from OpenAI text-embedding-3-small (1536 dim)
-- to DeepSeek deepseek-embedding (1024 dim).
--
-- Existing document chunks are nulled out — they will be re-embedded
-- automatically on the next RAG ingest run. No document rows are deleted.

-- 1. Drop the HNSW index (required before altering column type in pgvector).
drop index if exists idx_documents_embedding_hnsw;

-- 2. Nullify existing embeddings — they are dimension-incompatible with the
--    new model and would cause cosine-similarity errors if kept.
update public.documents set embedding = null where embedding is not null;

-- 3. Change the column dimension: 1536 (OpenAI) → 1024 (DeepSeek).
alter table public.documents
  alter column embedding type vector(1024);

-- 4. Recreate the HNSW index for cosine similarity search.
create index idx_documents_embedding_hnsw
  on public.documents
  using hnsw (embedding vector_cosine_ops);

-- 5. Drop legacy overload (match_count DEFAULT 4, similarity_threshold real).
drop function if exists public.match_documents(uuid, vector, integer, real);

-- 6. Replace the match_documents RPC to accept the new dimension.
create or replace function public.match_documents(
  agent           uuid,
  query_embedding vector(1024),
  match_count     int     default 5,
  similarity_threshold float default 0.3
)
returns table (
  id          uuid,
  content     text,
  source_name text,
  similarity  float
)
language sql stable
as $$
  select
    d.id,
    d.content,
    d.source_name,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.agent_id = agent
    and d.embedding is not null
    and 1 - (d.embedding <=> query_embedding) >= similarity_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
