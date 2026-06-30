-- Journal des messages pré-appel (Wati 26/06).
--
-- Une ligne par SMS / WhatsApp envoyé avant un appel (campaign.metadata
-- .precall_message). Le payload de campaign_targets s'écrase à chaque
-- tentative, donc on persiste l'historique ici pour l'onglet « SMS » du
-- dashboard. Le lien vers l'appel qui suit (« a-t-il décroché ? ») se fait
-- côté API par target_id + ordre temporel.
create table if not exists public.precall_sms_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid,
  target_id uuid,
  contact_id uuid,
  to_e164 text,
  lead_name text,
  channel text not null default 'sms',
  content_sid text,
  twilio_sid text,
  status text not null default 'sent',   -- 'sent' | 'failed'
  error text,
  attempt int,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_precall_sms_log_org_sent on public.precall_sms_log (org_id, sent_at desc);
create index if not exists idx_precall_sms_log_campaign on public.precall_sms_log (campaign_id, sent_at desc);
create index if not exists idx_precall_sms_log_target on public.precall_sms_log (target_id);

alter table public.precall_sms_log enable row level security;
drop policy if exists service_role_all on public.precall_sms_log;
create policy service_role_all on public.precall_sms_log
  as permissive for all to service_role using (true) with check (true);
grant all on public.precall_sms_log to service_role, postgres;
grant select on public.precall_sms_log to anon, authenticated;
