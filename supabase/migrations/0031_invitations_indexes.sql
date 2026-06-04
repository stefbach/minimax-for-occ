-- =========================================================================
--  Axon — invitations: extra indexes (Wave B)
--  Idempotent: safe to re-run.
--    * invitations_token_uq — unique index on token (also enforces uniqueness
--      should the original column-level unique ever be dropped).
--    * invitations_org_email_pending_idx — partial index speeding up the
--      "is there already a pending invite for this email in this org?" check
--      that POST /api/team/invites runs before insert.
-- =========================================================================

create unique index if not exists invitations_token_uq
  on public.invitations (token);

create index if not exists invitations_org_email_pending_idx
  on public.invitations (org_id, email)
  where accepted_at is null;

select 'DONE - invitations indexes ready' as status;
