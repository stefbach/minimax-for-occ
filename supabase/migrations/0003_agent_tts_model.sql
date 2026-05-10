-- Allow each agent to pick its TTS model independently of the env var.
-- Default null -> worker falls back to MINIMAX_TTS_MODEL env or library default.

alter table public.agents
  add column if not exists tts_model text;

-- Reasonable default for new rows: speech-02-hd (highest available stable HD).
-- Existing rows stay null so the worker uses its current behaviour.
