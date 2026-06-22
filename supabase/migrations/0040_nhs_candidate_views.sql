-- NHS pipeline candidate views (migrated from the legacy emerald project).
-- The native automations depend on these: the Orchestrateur Patient workflow
-- scans nhs_relance_candidates; first-contact / chase views mirror the same
-- source logic for reuse.

create or replace view public.nhs_relance_candidates as
  select l.id,
    l.id as lead_id,
    l.nom,
    l.email,
    l.numero_telephone,
    l.first_email_at
  from leads_rdv l
  where l.email_sent is true
    and l.raison_ne_pas_rappeler is null
    and (coalesce(l.qualification, ''::varchar)::text <> all
         (array['PAS INTERESSE','NE PAS RAPPELER','FAUX NUMERO','NON ELIGIBLE']::text[]))
    and l.last_response_date is null
    and coalesce(l.relance_email_sent, false) = false
    and l.first_email_at is not null
    and l.first_email_at <= (now() - interval '2 days');

create or replace view public.nhs_first_contact_candidates as
  select l.id,
    l.id as lead_id,
    l.nom,
    l.email,
    l.numero_telephone
  from leads_rdv l
  where coalesce(l.qualification, ''::varchar)::text = 'RDV CONFIRME'
    and coalesce(l.email_sent, false) = false
    and l.raison_ne_pas_rappeler is null
    and l.email is not null
    and l.email::text <> ''
    and l.numero_telephone::text like '+44%';

create or replace view public.nhs_chase_candidates as
  select l.id as lead_id,
    l.nom,
    l.email,
    l.numero_telephone,
    d.id as dossier_id,
    d.dossier_status,
    coalesce((select max(nd.received_at) from nhs_documents nd
              where nd.lead_id = l.id or nd.dossier_id = d.id), d.created_at) as no_docs_since
  from leads_rdv l
  join nhs_dossiers d on d.lead_id = l.id
  where l.email_sent is true
    and coalesce(l.do_not_call, false) = false
    and l.raison_ne_pas_rappeler is null
    and l.last_doc_chase_at is null
    and (d.dossier_status = any (array['NO_DOCUMENTS_RECEIVED','MISSING_DOCUMENTS']::text[]))
    and coalesce((select max(nd.received_at) from nhs_documents nd
                  where nd.lead_id = l.id or nd.dossier_id = d.id), d.created_at) < (now() - interval '7 days');
