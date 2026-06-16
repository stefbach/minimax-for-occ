import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";
import {
  buildPatient,
  buildPatientFromLead,
  deduplicateLeads,
  DOSSIER_SELECT,
  LEAD_SELECT,
  type DossierRow,
  type LeadRow,
  type NhsPatient,
} from "@/lib/nhs-patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Patient list behind the Suivi NHS S2 cards.
//
// Population: ALL leads with email_sent = true (the 63 people who received the
// explanation email). For each, we overlay the nhs_dossiers row if one exists.
// Leads without a dossier appear with status "aucun-doc" and 0/10 docs so they
// are visible and trackable. This ensures every card count matches the list.

export type NhsPatientsResponse = { patients: NhsPatient[] };

export async function GET(request: Request) {
  await requestOrgId(request);
  const legacy = nhsLegacyClient();
  try {
    // 1. All leads in the NHS S2 programme (both explanation email AND WhatsApp sent)
    const leadsRes = await legacy
      .from("leads_rdv")
      .select(LEAD_SELECT)
      .eq("email_sent", true)
      .eq("whatsapp_sent", true)
      .limit(10000);
    if (leadsRes.error) throw leadsRes.error;
    const leads = (leadsRes.data ?? []) as unknown as LeadRow[];

    // 2. Batch-fetch dossiers for those lead IDs and build a lookup map
    const leadIds = leads.map((l) => String(l.id));
    const dossierByLeadId = new Map<string, DossierRow>();
    for (let i = 0; i < leadIds.length; i += 200) {
      const { data } = await legacy
        .from("axon_nhs_dossiers_ro")
        .select(DOSSIER_SELECT)
        .in("lead_id", leadIds.slice(i, i + 200));
      for (const d of (data ?? []) as unknown as DossierRow[]) {
        if (d.lead_id) dossierByLeadId.set(String(d.lead_id), d);
      }
    }

    // Deduplicate: 85 raw rows → 63 unique patients (one entry per phone)
    const uniqueLeads = deduplicateLeads(leads, (id) => dossierByLeadId.has(id));

    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const patients: NhsPatient[] = uniqueLeads.map((l) => {
      const d = dossierByLeadId.get(String(l.id));
      return d ? buildPatient(d, l, threeDaysAgo) : buildPatientFromLead(l, threeDaysAgo);
    });

    patients.sort((a, b) => {
      const escDiff = Number(b.escalade) - Number(a.escalade);
      if (escDiff !== 0) return escDiff;
      const ta = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const tb = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return tb - ta;
    });

    // Flag duplicates: same phone number on more than one lead row
    const phoneCounts = new Map<string, number>();
    for (const p of patients) {
      if (p.phone) phoneCounts.set(p.phone, (phoneCounts.get(p.phone) ?? 0) + 1);
    }
    for (const p of patients) {
      if (p.phone && (phoneCounts.get(p.phone) ?? 0) > 1) p.duplicate = true;
    }

    return NextResponse.json({ patients } satisfies NhsPatientsResponse);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
