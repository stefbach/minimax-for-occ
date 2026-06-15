// Port of the legacy dashboard's /api/nhs-patients domain logic — the 11-doc
// NHS S2 pack, per-patient status derivation and the list/detail row shapes.
// Kept byte-compatible with the legacy rules so both dashboards always agree
// on a patient's status. Data comes from the legacy Supabase project via
// lib/nhs-legacy.ts (axon_nhs_dossiers_ro view + leads_rdv).

export const NHS_DOCS = [
  { key: "doc_nhs_s2_form", required: true },
  { key: "doc_s2_provider_declaration", required: true },
  { key: "doc_cpam_certificate", required: true },
  { key: "doc_clinical_justification_gp", required: true },
  { key: "doc_medical_report", required: true },
  { key: "doc_undue_delay_letter", required: true },
  { key: "doc_patient_authorisation", required: true },
  { key: "doc_identity_document", required: true },
  { key: "doc_proof_of_residence", required: true },
  { key: "doc_bank_statements", required: false },
  { key: "doc_detailed_medical_estimate", required: true },
] as const;

export type NhsDocKey = (typeof NHS_DOCS)[number]["key"];
export type PatientStatus = "complets" | "partiels" | "sans-reponse" | "aucun-doc" | "envoye-nhs";

export type DossierRow = Record<string, unknown> & {
  id: string;
  lead_id: string | null;
  dossier_status: string | null;
  submission_ready: boolean | null;
  nhs_submission_status: string | null;
  nhs_submission_date: string | null;
  bank_statement_exception: boolean | null;
  last_analysed_at: string | null;
};

export type LeadRow = {
  id: string;
  nom: string | null;
  email: string | null;
  numero_telephone: string | null;
  patient_dob: string | null;
  email_sent: boolean | null;
  whatsapp_sent: boolean | null;
  relance_email_sent: boolean | null;
  relance_whatsapp_sent: boolean | null;
  relance_email_date: string | null;
  last_response_date: string | null;
  last_call_datetime: string | null;
  last_updated: string | null;
};

export interface NhsPatient {
  // id is ALWAYS the lead ID. dossier_id is set only when a dossier exists.
  // This allows leads without dossiers to appear in the list (email recipients
  // who haven't started a dossier yet are shown with aucun-doc status).
  id: string;
  dossier_id?: string;
  lead_id: string;
  name: string | null;
  initials: string;
  age: number | null;
  email: string | null;
  phone: string | null;
  status: PatientStatus;
  docs_received: number;
  docs_required: number;
  last_activity: string | null;
  nhs_status: string | null;
  escalade: boolean;
  bank_exception: boolean;
  duplicate?: boolean;
}

export function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function initialsOf(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "—";
}

export function countDocs(d: DossierRow): { received: number; required: number } {
  let received = 0;
  const required = NHS_DOCS.filter((x) => x.required).length;
  for (const doc of NHS_DOCS) {
    if (!doc.required) continue;
    if (d[doc.key] === "received") received++;
  }
  return { received, required };
}

function deriveStatus(d: DossierRow, l: LeadRow, received: number, threeDaysAgo: Date): PatientStatus {
  if (d.dossier_status === "SUBMITTED" || d.nhs_submission_status != null) return "envoye-nhs";
  if (d.dossier_status === "COMPLETE" || d.dossier_status === "READY_TO_SUBMIT" || d.submission_ready) {
    return "complets";
  }
  const noResponse =
    !!l.email_sent &&
    !l.last_response_date &&
    !!l.relance_email_sent &&
    !!l.relance_email_date &&
    new Date(l.relance_email_date) < threeDaysAgo;
  if (noResponse) return "sans-reponse";
  if (d.dossier_status === "NO_DOCUMENTS_RECEIVED") return "aucun-doc";
  if (d.dossier_status === "MISSING_DOCUMENTS") return "partiels";
  if (received === 0) return "aucun-doc";
  return "partiels";
}

// Build a patient from a dossier + lead pair. The patient ID is always the
// lead ID so that /patients/[id] can resolve by lead whether or not a dossier
// exists. dossier_id carries the nhs_dossiers PK for reference.
export function buildPatient(d: DossierRow, l: LeadRow, threeDaysAgo: Date): NhsPatient {
  const { received, required } = countDocs(d);
  const status = deriveStatus(d, l, received, threeDaysAgo);
  const lastActivity =
    d.last_analysed_at || l.last_response_date || l.relance_email_date || l.last_call_datetime || l.last_updated || null;
  return {
    id: l.id,
    dossier_id: d.id,
    lead_id: l.id,
    name: l.nom,
    initials: initialsOf(l.nom),
    age: ageFromDob(l.patient_dob),
    email: l.email,
    phone: l.numero_telephone,
    status,
    docs_received: received,
    docs_required: required,
    last_activity: lastActivity,
    nhs_status: d.nhs_submission_status,
    escalade: status === "sans-reponse",
    bank_exception: !!d.bank_statement_exception,
  };
}

// Build a patient from a lead alone — no dossier exists yet. Used for the
// 63 explanation-email recipients who haven't started their dossier.
export function buildPatientFromLead(l: LeadRow, threeDaysAgo: Date): NhsPatient {
  const required = NHS_DOCS.filter((x) => x.required).length;
  const noResponse =
    !!l.email_sent &&
    !l.last_response_date &&
    !!l.relance_email_sent &&
    !!l.relance_email_date &&
    new Date(l.relance_email_date) < threeDaysAgo;
  const status: PatientStatus = noResponse ? "sans-reponse" : "aucun-doc";
  const lastActivity =
    l.last_response_date || l.relance_email_date || l.last_call_datetime || l.last_updated || null;
  return {
    id: l.id,
    lead_id: l.id,
    name: l.nom,
    initials: initialsOf(l.nom),
    age: ageFromDob(l.patient_dob),
    email: l.email,
    phone: l.numero_telephone,
    status,
    docs_received: 0,
    docs_required: required,
    last_activity: lastActivity,
    nhs_status: null,
    escalade: status === "sans-reponse",
    bank_exception: false,
  };
}

export const DOSSIER_SELECT = `id, lead_id, dossier_status, submission_ready, nhs_submission_status, nhs_submission_date, bank_statement_exception, last_analysed_at, ${NHS_DOCS.map((d) => d.key).join(", ")}`;
export const LEAD_SELECT =
  "id, nom, email, numero_telephone, patient_dob, email_sent, whatsapp_sent, relance_email_sent, relance_whatsapp_sent, relance_email_date, last_response_date, last_call_datetime, last_updated";
