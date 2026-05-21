-- 0026_lock_memberships_orgs_rls.sql
--
-- Close the last critical RLS gap: memberships + organizations were
-- left wide open (`rls_enabled=false`) so anyone with the anon key
-- could read or modify the multi-tenant glue. Supabase advisor flags
-- this as the highest-severity finding on the project.
--
-- Strategy:
--   1. Define is_super_admin() as SECURITY DEFINER so policies can
--      reference it without triggering RLS recursion on memberships.
--   2. Enable RLS on both tables.
--   3. Permissive SELECT: users see their own memberships / the orgs
--      they belong to. Super_admins see everything (admin dashboards).
--   4. Writes restricted to super_admins. service_role bypasses RLS
--      so backend routes that use supabaseServer() are unaffected.

-- ─── 1. is_super_admin helper ──────────────────────────────────────────
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.role = 'super_admin'
  );
$$;

grant execute on function public.is_super_admin() to anon, authenticated, service_role;

-- ─── 2. memberships ────────────────────────────────────────────────────
alter table public.memberships enable row level security;

drop policy if exists "memberships_self_or_super" on public.memberships;
create policy "memberships_self_or_super" on public.memberships
  for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "memberships_write_super" on public.memberships;
create policy "memberships_write_super" on public.memberships
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ─── 3. organizations ──────────────────────────────────────────────────
alter table public.organizations enable row level security;

drop policy if exists "orgs_member_or_super" on public.organizations;
create policy "orgs_member_or_super" on public.organizations
  for select
  using (public.is_member_of(id) or public.is_super_admin());

drop policy if exists "orgs_write_super" on public.organizations;
create policy "orgs_write_super" on public.organizations
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ─── 4. Ensure service_role still has full access (sanity) ─────────────
grant all on public.memberships to service_role;
grant all on public.organizations to service_role;
