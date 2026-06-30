-- Incremental lead-claiming for engine.claim campaigns (Wati 26/06).
--
-- A campaign whose metadata.engine.claim.enabled = true reserves up to
-- volume.max_new_per_day brand-new leads/day from the SHARED data table,
-- tagging them claimed_by_campaign = its id. Other (non-claim) campaigns then
-- skip any claimed lead (the dialer's dynamic-selection filters on
-- `claimed_by_campaign IS NULL` for them), so a reserved patient is never
-- double-dialled — without the claim campaign grabbing the whole pool at once.
-- NULL for every existing lead, so existing campaigns are unaffected until a
-- claim happens.
alter table public.leads_rdv add column if not exists claimed_by_campaign uuid;

create index if not exists idx_leads_rdv_claimed_by_campaign
  on public.leads_rdv (claimed_by_campaign)
  where claimed_by_campaign is not null;
