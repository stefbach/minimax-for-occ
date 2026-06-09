-- 0034_dashboard_insights.sql
--
-- Shared cache for the AI Insights dashboard tab. The strategic analysis
-- (pulse, objections, trends, script audit, sentiment, hypotheses) is expensive
-- to generate (one LLM pass over every call summary in the period), so the
-- result is cached per org + period + filter signature. Every clinic user sees
-- the same report; "Re-générer" forces a fresh pass (force_refresh).

CREATE TABLE IF NOT EXISTS dashboard_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Deterministic signature of the request: period + filters + the set of
  -- analysed call ids. A new set of calls (e.g. fresh sync) yields a new key.
  cache_key text NOT NULL,
  period_label text,
  -- The full InsightsResult JSON returned to the client.
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, cache_key)
);

CREATE INDEX IF NOT EXISTS dashboard_insights_org_generated_idx
  ON dashboard_insights (org_id, generated_at DESC);

-- RLS: the API uses the service role (bypasses RLS) for read/write; direct
-- authenticated reads are restricted to members of the report's org.
ALTER TABLE dashboard_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_insights_select_org_members ON dashboard_insights;
CREATE POLICY dashboard_insights_select_org_members ON dashboard_insights
  FOR SELECT TO authenticated
  USING (org_id IN (
    SELECT org_id FROM memberships WHERE user_id = auth.uid()
  ));
