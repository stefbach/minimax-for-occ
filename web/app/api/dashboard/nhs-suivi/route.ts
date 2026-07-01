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
import { NHS_REPORT, NHS_REPORT_TOTAL_SUBMITTED } from "@/lib/nhs-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suivi patient NHS S2 — aggregate tiles for the dashboard cards.
//
// Population = leads with email_sent=true AND whatsapp_sent=true (the 60 confirmed
// NHS S2 programme patients after data cleanup). For each we overlay the
// nhs_dossiers row when one exists. Every card count is derived from this
// combined set so the number on the card always matches the count of patients
// shown when you click it.
//
// Comms counts (email J0, relance, WhatsApp, responses) come from leads_rdv.
// Doc / clinic / NHS-tracking counts come from nhs_dossiers (via the view).

const MONTHLY_OBJECTIVE = Number(process.env.NHS_MONTHLY_OBJECTIVE ?? 30);
const DOCS_TOTAL = 11;

export type NhsStalledPatient = {
  name: string | null;
  phone: string | null;
  email: string | null;
  docs_filled: number;
  docs_total: number;
  qualification: string | null;
  last_activity: string | null;
  days_stalled: number | null;
};

export type NhsCoordinatorQueue = {
  user_id: string | null;
  name: string;
  patients: { lead_id: string; name: string | null; phone: string | null; assigned_at: string | null; reason: string | null }[];
};

export type NhsSuiviResponse = {
  has_data: boolean;
  monthly_objective: number;
  submitted_this_month: number;
  pending_response_3d_plus: number;
  ready_to_submit: number;
  stalled: { count: number; patients: NhsStalledPatient[] };
  coordinators: NhsCoordinatorQueue[];
  clinic_docs: {
    medical_report: number;
    undue_delay_letter: number;
    s2_provider_declaration: number;
    medical_estimate: number;
  };
  comms: {
    email_j0_sent: number;
    email_j2_sent: number;
    whatsapp_sent: number;
    responses_received: number;
  };
  file_status: {
    no_document: number;
    partial: number;
    complete: number;
    no_response_3d: number;
  };
  nhs_tracking: {
    submitted: number;
    in_review: number;
    accepted: number;
    rejected: number;
  };
  pipeline: {
    initial_call: number;
    email_reminder: number;
    response_received: number;
    file_complete: number;
    nhs_submitted: number;
  };
};

// qualification for the stalled list (not in the shared LEAD_SELECT)
const LEAD_SELECT_EXT = LEAD_SELECT + ", qualification";
type LeadRowExt = LeadRow & { qualification: string | null };

// Clinic-produced docs: any truthy value (URL / "yes" / "generated") counts.
function truthyDoc(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s !== "" && !/^(false|no|non|0|pending|missing)$/i.test(s);
}

export async function GET(request: Request) {
  await requestOrgId(request);
  const legacy = nhsLegacyClient();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400_000);
  const fiveDaysAgoMs = now.getTime() - 5 * 86400_000;

  // ── Step 1: NHS S2 programme population (email AND WhatsApp both sent) ──
  let allLeads: LeadRowExt[] = [];
  try {
    const { data } = await legacy
      .from("leads_rdv")
      .select(LEAD_SELECT_EXT)
      .eq("email_sent", true)
      .eq("whatsapp_sent", true)
      .limit(10000);
    allLeads = (data ?? []) as unknown as LeadRowExt[];
  } catch { /* empty */ }

  // ── Step 2: overlay dossiers for those lead IDs ───────────────────────
  const leadIds = allLeads.map((l) => String(l.id));
  const dossierByLeadId = new Map<string, DossierRow>();
  for (let i = 0; i < leadIds.length; i += 200) {
    try {
      const { data } = await legacy
        .from("axon_nhs_dossiers_ro")
        .select(DOSSIER_SELECT)
        .in("lead_id", leadIds.slice(i, i + 200));
      for (const d of (data ?? []) as unknown as DossierRow[]) {
        if (d.lead_id) dossierByLeadId.set(String(d.lead_id), d);
      }
    } catch { /* ignore */ }
  }

  // ── Step 3: deduplicate (85 raw rows → 63 unique patients) + entries ───
  const uniqueLeads = deduplicateLeads(allLeads, (id) => dossierByLeadId.has(id));
  type Entry = { patient: NhsPatient; lead: LeadRowExt; d: DossierRow | null };
  const entries: Entry[] = uniqueLeads.map((l) => {
    const d = dossierByLeadId.get(String(l.id)) ?? null;
    return {
      patient: d ? buildPatient(d, l, threeDaysAgo) : buildPatientFromLead(l, threeDaysAgo),
      lead: l,
      d,
    };
  });

  const hasData = uniqueLeads.length > 0;

  // ── Step 4: comms from unique patients (J0=63, relance=9…) ───────────
  const comms = {
    email_j0_sent: uniqueLeads.length,
    email_j2_sent: uniqueLeads.filter(({ relance_email_sent: r }) => r).length,
    whatsapp_sent: uniqueLeads.filter(({ relance_whatsapp_sent: r }) => r).length,
    responses_received: uniqueLeads.filter(({ last_response_date: d }) => d).length,
  };

  // ── Step 5: file status from patient statuses (matches list chips) ─────
  // no_document counts ANY patient with 0 docs received, including those also
  // flagged "sans-reponse" — both buckets can overlap and both show 0 docs.
  const pending3d = entries.filter(({ patient }) => patient.status === "sans-reponse").length;
  const file_status = {
    no_document: entries.filter(({ patient }) => patient.docs_received === 0).length,
    partial:     entries.filter(({ patient }) => patient.status === "partiels").length,
    complete:    entries.filter(({ patient }) => patient.status === "complets").length,
    no_response_3d: pending3d,
  };

  // ── Step 6: dossier-based counts (clinic docs, NHS tracking) ──────────
  // Use hardcoded NHS report data (clinic manager's actual counts) when automation
  // workflow is inactive and no dossier data is available.
  const hasAutomationData = allLeads.some((l) => dossierByLeadId.has(String(l.id)));
  const clinicDocs = { medical_report: 0, undue_delay_letter: 0, s2_provider_declaration: 0, medical_estimate: 0 };
  const tracking = hasAutomationData ?
    { submitted: 0, in_review: 0, accepted: 0, rejected: 0 } :
    {
      submitted: NHS_REPORT_TOTAL_SUBMITTED,
      in_review: NHS_REPORT.pending_nhs.patients.length,
      accepted: NHS_REPORT.approved.patients.length,
      rejected: NHS_REPORT.rejected.patients.length,
    };
  let readyToSubmit = hasAutomationData ? 0 : NHS_REPORT.to_submit.patients.length;
  let submittedThisMonth = 0;
  for (const { d, patient } of entries) {
    if (!d) continue; // no dossier yet — skip clinic/NHS counts
    if (truthyDoc(d["doc_medical_report"])) clinicDocs.medical_report++;
    if (truthyDoc(d["doc_undue_delay_letter"])) clinicDocs.undue_delay_letter++;
    if (truthyDoc(d["doc_s2_provider_declaration"])) clinicDocs.s2_provider_declaration++;
    // Medical estimate is only produced by the clinic once ALL patient docs are in
    const fileComplete = patient.status === "complets" || patient.status === "envoye-nhs";
    if (fileComplete && truthyDoc(d["doc_detailed_medical_estimate"])) clinicDocs.medical_estimate++;

    const submissionDate = d.nhs_submission_date;
    const submissionStatus = d.nhs_submission_status;
    const submitted = Boolean(submissionDate) || Boolean(submissionStatus?.trim());
    if (submitted) tracking.submitted++;
    const status = (submissionStatus ?? "").toLowerCase();
    if (/review|pending|instruction|examen/.test(status)) tracking.in_review++;
    if (/accept|approv/.test(status)) tracking.accepted++;
    if (/refus|reject/.test(status)) tracking.rejected++;

    if (d.submission_ready && !submitted) readyToSubmit++;
    if (submissionDate && submissionDate >= monthStart) submittedThisMonth++;
  }

  // ── Step 7: stalled patients (partiels/aucun-doc, no activity 5j+) ────
  const stalledPatients: NhsStalledPatient[] = [];
  for (const { patient, lead } of entries) {
    if (patient.status !== "partiels" && patient.status !== "aucun-doc") continue;
    const lastMs = patient.last_activity ? new Date(patient.last_activity).getTime() : null;
    if (lastMs !== null && lastMs >= fiveDaysAgoMs) continue;
    stalledPatients.push({
      name: patient.name,
      phone: patient.phone,
      email: patient.email,
      docs_filled: patient.docs_received,
      docs_total: DOCS_TOTAL,
      qualification: lead.qualification,
      last_activity: patient.last_activity,
      days_stalled: lastMs === null ? null : Math.floor((now.getTime() - lastMs) / 86400_000),
    });
  }
  stalledPatients.sort((a, b) => {
    const am = a.last_activity ? new Date(a.last_activity).getTime() : -Infinity;
    const bm = b.last_activity ? new Date(b.last_activity).getTime() : -Infinity;
    return am - bm;
  });

  // ── Step 8: pipeline (lead-scoped, matching the 63 population) ─────────
  const pipeline = {
    initial_call: uniqueLeads.filter((l) => !!l.last_call_datetime).length,
    email_reminder: comms.email_j2_sent,
    response_received: comms.responses_received,
    file_complete: entries.filter(({ patient: p }) => p.status === "complets" || p.status === "envoye-nhs").length,
    nhs_submitted: tracking.submitted,
  };

  // ── Step 9: coordinator queues (driven by users.is_nhs_coordinator) ───
  // Coordinators come from public.users (flagged via is_nhs_coordinator). The
  // display order matches what the legacy hardcoded list used.
  const COORDINATOR_ORDER = ["summer", "rain", "stormi"];
  const queuesByUser = new Map<string, NhsCoordinatorQueue>();
  const queuesByLegacyName = new Map<string, NhsCoordinatorQueue>();
  try {
    const { data: coords } = await legacy
      .from("axon_coordinators_ro")
      .select("id, full_name, email");
    type CoordRow = { id: string; full_name: string | null; email: string | null };
    for (const c of (coords ?? []) as CoordRow[]) {
      const displayName = (c.full_name ?? c.email ?? "").trim();
      // Title-case the first character so "rain" displays as "Rain".
      const titled = displayName ? displayName[0].toUpperCase() + displayName.slice(1) : "—";
      const queue: NhsCoordinatorQueue = { user_id: c.id, name: titled, patients: [] };
      queuesByUser.set(c.id, queue);
      // Legacy fallback: assignment rows written before the migration carry
      // assigned_to as a name string. Index by the first word of full_name to
      // resolve those.
      const firstName = displayName.split(/\s+/)[0]?.toLowerCase();
      if (firstName) queuesByLegacyName.set(firstName, queue);
    }
  } catch { /* coordinators unreachable — leave queues empty */ }

  try {
    const { data: assigns } = await legacy
      .from("axon_assignments_ro")
      .select("lead_id, assigned_to, assigned_to_user_id, reason, assigned_at, status")
      .order("assigned_at", { ascending: false })
      .limit(2000);
    type Assign = { lead_id: string; assigned_to: string | null; assigned_to_user_id: string | null; reason: string | null; assigned_at: string | null; status: string | null };
    const latestPerLead = new Map<string, Assign>();
    for (const a of (assigns ?? []) as Assign[]) {
      if (!a.lead_id || latestPerLead.has(a.lead_id)) continue;
      latestPerLead.set(a.lead_id, a);
    }
    const open = [...latestPerLead.values()].filter(
      (a) => (a.assigned_to_user_id || a.assigned_to) && (!a.status || a.status === "open"),
    );
    const assignIds = open.map((a) => a.lead_id);
    const assignLeadById = new Map<string, { nom: string | null; numero_telephone: string | null }>();
    for (let i = 0; i < assignIds.length; i += 200) {
      const { data: leadRows } = await legacy
        .from("leads_rdv")
        .select("id, nom, numero_telephone")
        .in("id", assignIds.slice(i, i + 200));
      for (const l of (leadRows ?? []) as Array<{ id: string; nom: string | null; numero_telephone: string | null }>) {
        assignLeadById.set(String(l.id), { nom: l.nom, numero_telephone: l.numero_telephone });
      }
    }
    for (const a of open) {
      // Prefer the real FK, fall back to the legacy name string.
      const queue =
        (a.assigned_to_user_id && queuesByUser.get(a.assigned_to_user_id)) ||
        queuesByLegacyName.get((a.assigned_to ?? "").trim().toLowerCase());
      if (!queue) continue;
      const lead = assignLeadById.get(String(a.lead_id));
      queue.patients.push({
        lead_id: String(a.lead_id),
        name: lead?.nom ?? null,
        phone: lead?.numero_telephone ?? null,
        assigned_at: a.assigned_at,
        reason: a.reason,
      });
    }
  } catch { /* assignments unreachable — empty queues */ }

  const body: NhsSuiviResponse = {
    has_data: hasData,
    monthly_objective: MONTHLY_OBJECTIVE,
    submitted_this_month: submittedThisMonth,
    pending_response_3d_plus: pending3d,
    ready_to_submit: readyToSubmit,
    stalled: { count: stalledPatients.length, patients: stalledPatients.slice(0, 100) },
    coordinators: (() => {
      // Stable ordering: known names (Summer/Rain/Stormi) first in their legacy
      // order, then any future coordinators appended alphabetically.
      const all = [...queuesByUser.values()];
      const idx = (q: NhsCoordinatorQueue) => {
        const i = COORDINATOR_ORDER.indexOf(q.name.toLowerCase());
        return i === -1 ? 999 : i;
      };
      return all.sort((a, b) => idx(a) - idx(b) || a.name.localeCompare(b.name));
    })(),
    clinic_docs: clinicDocs,
    comms,
    file_status,
    nhs_tracking: tracking,
    pipeline,
  };
  return NextResponse.json(body);
}
