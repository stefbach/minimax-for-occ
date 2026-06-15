import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";
import {
  buildPatient,
  DOSSIER_SELECT,
  LEAD_SELECT,
  type DossierRow,
  type LeadRow,
  type NhsPatient,
} from "@/lib/nhs-patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suivi patient NHS S2 — aggregate tiles for the OCC weight management
// programme.
//
// All counts are derived from the SAME dossier+lead join used by the patient
// list (/api/dashboard/nhs-suivi/patients). This guarantees that the number
// shown on a card always matches the number of patients you see when you click
// it. The legacy route counted directly from leads_rdv (7 000+ rows) while the
// patient list iterated axon_nhs_dossiers_ro (~38 rows), causing the visible
// mismatch (e.g. "85" on the card, "34" in the list).

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

// Include qualification for the stalled list (not in the shared LEAD_SELECT).
const LEAD_SELECT_EXT = LEAD_SELECT + ", qualification";
type LeadRowExt = LeadRow & { qualification: string | null };

// Doc cells are text (URL / yes / status word); treat empty + negative words
// as "not produced" — used only for clinic-produced docs, not patient docs.
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

  // ── Step 1: fetch dossiers (same view the patient list uses) ──────────
  let dossiers: DossierRow[] = [];
  try {
    const { data } = await legacy
      .from("axon_nhs_dossiers_ro")
      .select(DOSSIER_SELECT)
      .limit(10000);
    dossiers = (data ?? []) as unknown as DossierRow[];
  } catch { /* view unreachable — tiles stay at 0 */ }

  // ── Step 2: fetch leads for those dossier lead_ids only ───────────────
  const leadIds = [...new Set(dossiers.map((d) => d.lead_id).filter((id): id is string => Boolean(id)))];
  const leadById = new Map<string, LeadRowExt>();
  for (let i = 0; i < leadIds.length; i += 200) {
    try {
      const { data } = await legacy
        .from("leads_rdv")
        .select(LEAD_SELECT_EXT)
        .in("id", leadIds.slice(i, i + 200));
      for (const l of (data ?? []) as unknown as LeadRowExt[]) {
        leadById.set(String(l.id), l);
      }
    } catch { /* ignore batch error */ }
  }

  // ── Step 3: build entries (same pairing as the patient list) ──────────
  type Entry = { patient: NhsPatient; lead: LeadRowExt; d: DossierRow };
  const entries: Entry[] = [];
  for (const d of dossiers) {
    if (!d.lead_id) continue;
    const lead = leadById.get(String(d.lead_id));
    if (!lead) continue;
    entries.push({ patient: buildPatient(d, lead, threeDaysAgo), lead, d });
  }

  const hasData = entries.length > 0;

  // ── Step 4: comms counts (scoped to dossier-linked leads) ─────────────
  const comms = {
    email_j0_sent: entries.filter(({ lead }) => lead.email_sent).length,
    email_j2_sent: entries.filter(({ lead }) => lead.relance_email_sent).length,
    whatsapp_sent: entries.filter(({ lead }) => lead.relance_whatsapp_sent || lead.whatsapp_sent).length,
    responses_received: entries.filter(({ lead }) => lead.last_response_date).length,
  };

  // ── Step 5: file status = patient statuses (matches the list's chips) ──
  const pending3d = entries.filter(({ patient }) => patient.status === "sans-reponse").length;
  const file_status = {
    no_document: entries.filter(({ patient }) => patient.status === "aucun-doc").length,
    partial: entries.filter(({ patient }) => patient.status === "partiels").length,
    complete: entries.filter(({ patient }) => patient.status === "complets").length,
    no_response_3d: pending3d,
  };

  // ── Step 6: clinic docs + NHS tracking + ready / submitted ────────────
  const clinicDocs = { medical_report: 0, undue_delay_letter: 0, s2_provider_declaration: 0, medical_estimate: 0 };
  const tracking = { submitted: 0, in_review: 0, accepted: 0, rejected: 0 };
  let readyToSubmit = 0;
  let submittedThisMonth = 0;
  for (const { d } of entries) {
    if (truthyDoc(d["doc_medical_report"])) clinicDocs.medical_report++;
    if (truthyDoc(d["doc_undue_delay_letter"])) clinicDocs.undue_delay_letter++;
    if (truthyDoc(d["doc_s2_provider_declaration"])) clinicDocs.s2_provider_declaration++;
    if (truthyDoc(d["doc_detailed_medical_estimate"])) clinicDocs.medical_estimate++;

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

  // ── Step 8: pipeline ──────────────────────────────────────────────────
  const pipeline = {
    initial_call: entries.filter(({ lead }) => !!lead.last_call_datetime).length,
    email_reminder: comms.email_j2_sent,
    response_received: comms.responses_received,
    file_complete: entries.filter(({ patient }) => patient.status === "complets" || patient.status === "envoye-nhs").length,
    nhs_submitted: tracking.submitted,
  };

  // ── Step 9: coordinator queues (independent of dossiers) ──────────────
  const COORDINATORS = ["Summer", "Rain", "Stormi"];
  const queues = new Map<string, NhsCoordinatorQueue>(
    COORDINATORS.map((n) => [n.toLowerCase(), { name: n, patients: [] }]),
  );
  try {
    const { data: assigns } = await legacy
      .from("axon_assignments_ro")
      .select("lead_id, assigned_to, reason, assigned_at, status")
      .order("assigned_at", { ascending: false })
      .limit(2000);
    type Assign = { lead_id: string; assigned_to: string | null; reason: string | null; assigned_at: string | null; status: string | null };
    const latestPerLead = new Map<string, Assign>();
    for (const a of (assigns ?? []) as Assign[]) {
      if (!a.lead_id || latestPerLead.has(a.lead_id)) continue;
      latestPerLead.set(a.lead_id, a);
    }
    const open = [...latestPerLead.values()].filter(
      (a) => a.assigned_to && (!a.status || a.status === "open"),
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
      const queue = queues.get((a.assigned_to ?? "").trim().toLowerCase());
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
    coordinators: COORDINATORS.map((n) => queues.get(n.toLowerCase())!),
    clinic_docs: clinicDocs,
    comms,
    file_status,
    nhs_tracking: tracking,
    pipeline,
  };
  return NextResponse.json(body);
}
