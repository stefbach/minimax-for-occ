-- Fix: PostgREST returned 403 'permission denied for table ...' on agents,
-- voices, documents, etc. — the previous migrations created tables but
-- relied on Supabase's implicit GRANTs, which don't always fire when SQL is
-- pasted manually into the SQL editor (vs. created through the Supabase
-- table builder UI).
--
-- This migration is idempotent and safe to run any time.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- Make every future table / sequence / function automatically grantable
-- without having to re-run this migration.
alter default privileges in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
