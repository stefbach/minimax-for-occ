import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";
import { buildPatient, DOSSIER_SELECT, LEAD_SELECT, type DossierRow, type LeadRow, type NhsPatient } from "@/lib/nhs-patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Patient list behind the Suivi NHS S2 cards — port of the legacy
// /api/nhs-patients endpoint (same status rules, same sort: escalations
// first, then most recent activity).

export type NhsPatientsResponse = { patients: NhsPatient[] };

export async function GET(request: Request) {
  await requestOrgId(request); // auth context — dashboard is behind login
  const legacy = nhsLegacyClient();
  try {
    const [dossiersRes, leadsRes] = await Promise.all([
      legacy.from("axon_nhs_dossiers_ro").select(DOSSIER_SELECT).limit(10000),
      legacy.from("leads_rdv").select(LEAD_SELECT).limit(20000),
    ]);
    if (dossiersRes.error) throw dossiersRes.error;
    if (leadsRes.error) throw leadsRes.error;

    const dossiers = (dossiersRes.data ?? []) as unknown as DossierRow[];
    const leads = (leadsRes.data ?? []) as unknown as LeadRow[];
    const leadById = new Map(leads.map((l) => [String(l.id), l]));

    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const patients: NhsPatient[] = [];
    for (const d of dossiers) {
      if (!d.lead_id) continue;
      const lead = leadById.get(String(d.lead_id));
      if (!lead) continue;
      patients.push(buildPatient(d, lead, threeDaysAgo));
    }
    patients.sort((a, b) => {
      const escDiff = Number(b.escalade) - Number(a.escalade);
      if (escDiff !== 0) return escDiff;
      const ta = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const tb = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return tb - ta;
    });

    // Flag duplicates: same phone number appearing on more than one dossier.
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
