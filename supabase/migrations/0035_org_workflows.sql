-- 0035_org_workflows.sql
--
-- Native Axon automations ("mini-n8n"). Replaces the n8n dependency for
-- tenant-facing workflows: a workflow = trigger (cron table-scan) + filter
-- + ordered steps (send email via SMTP, send WhatsApp via WATI, update the
-- row). Credentials live in org_credentials, referenced by id from steps.
--
-- Design notes:
--   • Triggers are cron-driven (Vercel cron hits /api/automations/cron
--     every 5 min; each active workflow runs when its every_minutes is due).
--   • The canonical trigger is 'table_scan': query a tenant data table with
--     simple filters, run the steps once per matching row. Idempotence comes
--     from per-step skip_if flags (e.g. email_sent) + mark fields, exactly
--     like OCC's historical n8n flow gated on email_sent/whatsapp_sent.
--   • org_credentials.data holds secrets (SMTP app password, WATI bearer).
--     RLS denies all authenticated access; only the service role (API
--     routes) reads them, and the API never returns `data` to the client.

CREATE TABLE IF NOT EXISTS org_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- 'smtp' | 'wati' | 'http_bearer'
  kind text NOT NULL CHECK (kind IN ('smtp', 'wati', 'http_bearer')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
ALTER TABLE org_credentials ENABLE ROW LEVEL SECURITY;
-- No authenticated policies: service-role only.

CREATE TABLE IF NOT EXISTS org_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT false,
  -- { type: 'table_scan', every_minutes: 5, table: 'leads_rdv',
  --   filters: [{column, op, value}], max_rows_per_run: 50 }
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered list. Step shapes (executed per matching row):
  --  { type:'send_email_smtp', credential_id, to:'{{email}}', subject, html,
  --    skip_if_column:'email_sent', mark_column:'email_sent' }
  --  { type:'send_wati_template', credential_id, phone:'{{numero_telephone}}',
  --    template_name, broadcast_prefix, parameters:[{name,value}],
  --    skip_if_column:'whatsapp_sent', mark_column:'whatsapp_sent' }
  --  { type:'update_row', set: {col: value} }
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
ALTER TABLE org_workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_workflows_select_members ON org_workflows;
CREATE POLICY org_workflows_select_members ON org_workflows
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS org_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES org_workflows(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- 'ok' | 'error' | 'running'
  status text NOT NULL DEFAULT 'running',
  -- rows matched / actions performed / skipped / errors
  matched int NOT NULL DEFAULT 0,
  actions int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  errors int NOT NULL DEFAULT 0,
  log jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS org_workflow_runs_wf_idx
  ON org_workflow_runs (workflow_id, started_at DESC);
ALTER TABLE org_workflow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_workflow_runs_select_members ON org_workflow_runs;
CREATE POLICY org_workflow_runs_select_members ON org_workflow_runs
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()));
