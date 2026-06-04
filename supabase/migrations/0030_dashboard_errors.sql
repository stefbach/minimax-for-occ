-- dashboard_errors: org-scoped system error log surfaced in the
-- "Erreurs & Alertes" dashboard tab. Idempotent.
CREATE TABLE IF NOT EXISTS public.dashboard_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  error_type text NOT NULL,
  message text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS dashboard_errors_org_occurred_idx
  ON public.dashboard_errors (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS dashboard_errors_type_idx
  ON public.dashboard_errors (error_type);

ALTER TABLE public.dashboard_errors ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; this policy lets authenticated members of an org
-- read their own org's rows when a user-scoped client queries directly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='dashboard_errors'
      AND policyname='dashboard_errors_org_select'
  ) THEN
    CREATE POLICY dashboard_errors_org_select
      ON public.dashboard_errors FOR SELECT
      USING (
        org_id IN (
          SELECT m.org_id FROM public.memberships m
          WHERE m.user_id = auth.uid()
        )
      );
  END IF;
END$$;
