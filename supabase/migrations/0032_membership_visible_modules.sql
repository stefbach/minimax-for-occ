-- 0032_membership_visible_modules.sql
--
-- Per-user granular module visibility. The DEFAULT visibility per role lives
-- in code (web/lib/permissions.ts → defaultModulesForRole). When a row has
-- visible_modules = NULL the user inherits the role default. When it is set
-- (JSON array of module ids), it OVERRIDES the role default and the user
-- sees ONLY those modules. This lets the owner subtract specific UI surfaces
-- from individual users (e.g. an OCC agent without "Tableau d'analyse")
-- without having to invent a new role for every combination.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS visible_modules jsonb;

COMMENT ON COLUMN memberships.visible_modules IS
  'When NULL, the user sees the role default. When a JSON array of module ids, the user sees ONLY those.';
