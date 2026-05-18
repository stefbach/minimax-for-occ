-- ============================================================================
--  Phase 1 — Organizations.active flag
--  Used by super_admin to deactivate an organization without deleting its data.
--  Application code should treat active=false as "blocked / read-only".
-- ============================================================================

alter table public.organizations
  add column if not exists active boolean not null default true;
