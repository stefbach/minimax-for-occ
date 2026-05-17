-- =========================================================================
--  Axon — role-based access foundation
--  - Document the canonical roles the platform expects.
--  - Backfill existing `admin` memberships unchanged.
--  - Add an index on (user_id) for fast landing-page redirects.
-- =========================================================================

-- We intentionally do NOT add a CHECK constraint so older deployments stay
-- compatible. Canonical values understood by the front-end:
--   super_admin  : Axon platform team — sees everything across all orgs
--   admin        : owns the org — full access, billing, users
--   manager      : pilots campaigns, sees analytics, no billing/user mgmt
--   supervisor   : live call supervision (listen/whisper/barge)
--   agent        : human agent — softphone only

comment on column public.memberships.role is
  'super_admin | admin | manager | supervisor | agent';

create index if not exists idx_memberships_user_org
  on public.memberships (user_id, org_id);
