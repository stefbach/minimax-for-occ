-- 0036_workflow_engine_v2.sql
--
-- Native automation engine v2: the OCC patient-document pipeline migrated off
-- n8n into native Axon automations. The seven agents (orchestrator + A2..A7)
-- are org_workflows rows; their AI brains, Gmail access, the patient-pipeline
-- Supabase project, and Telegram monitoring are referenced as org_credentials.
--
-- Schema-wise the engine is data-driven (trigger/steps are jsonb), so the only
-- DDL needed is widening the credential-kind whitelist to cover the new
-- integration types.
--
--   supabase_data — the patient pipeline project { url, service_key }
--   anthropic     — AI brain { api_key, default_model? }
--   gmail_oauth   — inbox read + send/draft { client_id, client_secret, refresh_token, sender? }
--   telegram      — monitoring { bot_token, chat_id? }

ALTER TABLE org_credentials DROP CONSTRAINT IF EXISTS org_credentials_kind_check;
ALTER TABLE org_credentials
  ADD CONSTRAINT org_credentials_kind_check
  CHECK (kind IN (
    'smtp', 'wati', 'http_bearer',
    'supabase_data', 'anthropic', 'gmail_oauth', 'telegram'
  ));
