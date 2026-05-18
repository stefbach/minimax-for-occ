-- 0014_phone_numbers_country.sql
-- Phase 2: multi-country geo-routing for phone_numbers.
--
-- Adds the country metadata required to pick a from_number that matches the
-- destination's country at dial time. is_default lets each org designate one
-- fallback number when no country match exists.
--
-- Safe to re-apply: every statement uses IF NOT EXISTS.

alter table public.phone_numbers
  add column if not exists country_code char(2),   -- ISO 3166-1 alpha-2: FR, BE, US
  add column if not exists prefix       text,      -- E.164 country prefix: +33, +44, +1
  add column if not exists is_default   boolean not null default false;

-- One default per org.
create unique index if not exists uniq_default_per_org
  on public.phone_numbers(org_id)
  where is_default = true;

-- Lookup index for the geo-routing query (org_id, country_code).
create index if not exists idx_phone_numbers_org_country
  on public.phone_numbers (org_id, country_code);
