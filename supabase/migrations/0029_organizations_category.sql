-- =========================================================================
--  Add a free-form `category` field to organizations.
--
--  Used by the Axon admin's "create client" wizard so super_admins can tag
--  each client with their business vertical (Hôtel, Clinique, Call Center,
--  …). Free-text rather than enum so new categories don't require a
--  migration. A datalist in the UI nudges toward common values.
--
--  Later use: surface vertical-specific templates / dashboards by category.
-- =========================================================================

alter table public.organizations
  add column if not exists category text;

comment on column public.organizations.category is
  'Free-form client category (Hôtel, Restaurant, Clinique, Call Center, …). Used to surface vertical-specific templates later.';

create index if not exists idx_organizations_category
  on public.organizations (category);
