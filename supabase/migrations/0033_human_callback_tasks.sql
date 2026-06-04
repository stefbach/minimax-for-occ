-- 0033_human_callback_tasks.sql
--
-- "Appels du jour" workflow: when the IA agent decides during a call that
-- the patient needs a human follow-up, it stamps a human_callback_task
-- scheduled for the next business day. The morning of, the task list is
-- auto-distributed (round-robin) to active human agents; supervisors can
-- reassign manually. Human agents see their list on /desk.

CREATE TABLE IF NOT EXISTS human_callback_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- The original IA call that triggered the transfer (nullable for manual creations).
  original_call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  -- The IA agent_handle that initiated the transfer (audit).
  transferred_by_agent_id uuid REFERENCES agent_handles(id) ON DELETE SET NULL,
  qualification text,           -- e.g. 'RDV demandé', 'Question complexe'
  transfer_reason text,         -- free text from the IA tool
  scheduled_for timestamptz NOT NULL,  -- when the human should call back
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  notes text,
  outcome_call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  outcome_disposition text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hct_org_scheduled_idx
  ON human_callback_tasks (org_id, scheduled_for);
CREATE INDEX IF NOT EXISTS hct_org_assigned_pending_idx
  ON human_callback_tasks (org_id, assigned_to)
  WHERE status IN ('pending','in_progress');

-- Auto-distribution debounce stamp: when set to today's UTC date, the
-- morning round-robin has already run for this org today.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS last_distribution_at_utc_date date;

-- RLS: API uses the service role (which bypasses RLS) for all writes;
-- direct authenticated reads are restricted to members of the task's org.
ALTER TABLE human_callback_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hct_select_org_members ON human_callback_tasks;
CREATE POLICY hct_select_org_members ON human_callback_tasks
  FOR SELECT TO authenticated
  USING (org_id IN (
    SELECT org_id FROM memberships WHERE user_id = auth.uid()
  ));
