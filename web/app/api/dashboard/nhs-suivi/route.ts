import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suivi patient NHS S2 — pipeline panel for the OCC weight management
// programme.
//
// DATA SOURCE: the legacy dashboard's Supabase project (emerald-ocean), NOT
// Axon's own database. The NHS workflow (n8n: emails J0/J+2, WhatsApp, doc
// tracking, dossier analysis, coordinator assignments) writes to that project:
//   - leads_rdv             → comms flags, document_status, response dates
//   - axon_nhs_dossiers_ro  → read-only view over nhs_dossiers (doc_*,
//                             submission_ready, nhs_submission_status…)
//   - axon_assignments_ro   → read-only view over dashboard_assignments
//                             (Summer / Rain / Stormi queues)
// The views were created for this dashboard and expose only the columns we
// aggregate. The publishable (anon) key suffices: leads_rdv has a public-read
// policy and the views are granted to anon. Both URL and key can be overridden
// via env (NHS_LEGACY_SUPABASE_URL / NHS_LEGACY_SUPABASE_KEY) — e.g. to use a
// service key or point a different tenant elsewhere.
//
// Axon's previous implementation read its own (lime-window) copies of these
// columns, which the NHS workflow never updates — every tile showed 0.

const LEGACY_URL =
  process.env.NHS_LEGACY_SUPABASE_URL ?? "https://kgohjmivilsfoewrcovn.supabase.co";
// Publishable anon key (public by design — same key the legacy frontend ships).
const LEGACY_KEY =
  process.env.NHS_LEGACY_SUPABASE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnb2hqbWl2aWxzZm9ld3Jjb3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxNTMxMDYsImV4cCI6MjA2MjcyOTEwNn0.E_eRu1s2vpGNDNIF1L_I6T9UQsTtKKQaU94oZISpmws";

const MONTHLY_OBJECTIVE = Number(process.env.NHS_MONTHLY_OBJECTIVE ?? 30);
// All 11 required documents of the S2 pack — used as the denominator for the
// stalled list's "docs X/11" column.
const DOCS_TOTAL = 11;

export type NhsStalledPatient = {
  name: string | null;
  phone: string | null;
  email: string | null;
  docs_filled: number;
  docs_total: number;
  qualification: string | null;
  last_activity: string | null; // ISO; null = no activity recorded at all
  days_stalled: number | null;  // null when last_activity is null
};

export type NhsCoordinatorQueue = {
  name: string; // Summer | Rain | Stormi
  patients: { name: string | null; phone: string | null; assigned_at: string | null; reason: string | null }[];
};

export type NhsSuiviResponse = {
  has_data: boolean;
  monthly_objective: number;
  submitted_this_month: number;
  pending_response_3d_plus: number;
  ready_to_submit: number;
  // Dossiers partiels (documents manquants) sans activité depuis 5 jours+.
  stalled: { count: number; patients: NhsStalledPatient[] };
  // Files coordinateurs — mêmes files Summer / Rain / Stormi que le legacy.
  coordinators: NhsCoordinatorQueue[];
  // Documents à produire par la clinique (nhs_dossiers.doc_*).
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

type DossierRow = {
  lead_id: string | null;
  submission_ready: boolean | null;
  nhs_submission_status: string | null;
  nhs_submission_date: string | null;
  dossier_status: string | null;
  updated_at: string | null;
  doc_medical_report: string | null;
  doc_undue_delay_letter: string | null;
  doc_s2_provider_declaration: string | null;
  doc_detailed_medical_estimate: string | null;
};

// Doc cells are text (URL / yes / status word); treat empty + negative words
// as "not produced".
function truthyDoc(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s !== "" && !/^(false|no|non|0|pending|missing)$/i.test(s);
}

export async function GET(request: Request) {
  // Auth context (the dashboard is behind login); data itself comes from the
  // legacy project below.
  await requestOrgId(request);
  const legacy = createClient(LEGACY_URL, LEGACY_KEY, { auth: { persistSession: false } });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const threeDaysAgoMs = now.getTime() - 3 * 86400_000;
  const fiveDaysAgoMs = now.getTime() - 5 * 86400_000;

  const countLeads = async (build: (q: any) => any): Promise<number> => {
    try {
      const { count, error } = await build(
        legacy.from("leads_rdv").select("id", { count: "exact", head: true }),
      );
      if (error) return 0;
      return count ?? 0;
    } catch {
      return 0;
    }
  };

  // ── Communication patient (leads_rdv flags, written by n8n) ───────────
  const [emailJ0, emailJ2, whatsapp, responses, initialCall] = await Promise.all([
    countLeads((q) => q.eq("email_sent", true)),
    countLeads((q) => q.eq("relance_email_sent", true)),
    countLeads((q) => q.eq("relance_whatsapp_sent", true)),
    countLeads((q) => q.not("last_response_date", "is", null)),
    countLeads((q) => q.not("last_call_datetime", "is", null)),
  ]);
  const hasData = emailJ0 > 0 || initialCall > 0;

  // ── Statut des dossiers côté leads (document_status, scope = emailed) ──
  // Values observed in production: NULL, NO_DOCUMENTS_RECEIVED,
  // MISSING_DOCUMENTS (+ future COMPLETE/ALL_DOCUMENTS_RECEIVED).
  const [noDocument, partialDocs, completeDocs] = await Promise.all([
    countLeads((q) =>
      q.eq("email_sent", true).or("document_status.is.null,document_status.ilike.%no_document%,document_status.ilike.%aucun%"),
    ),
    countLeads((q) =>
      q.or("document_status.ilike.%missing%,document_status.ilike.%partial%,document_status.ilike.%partiel%"),
    ),
    countLeads((q) =>
      q.in("document_status", ["COMPLETE", "COMPLET", "ALL_DOCUMENTS_RECEIVED", "ALL_RECEIVED"]),
    ),
  ]);

  // ── Dossiers NHS (read-only view over nhs_dossiers) ────────────────────
  let dossiers: DossierRow[] = [];
  try {
    const { data } = await legacy
      .from("axon_nhs_dossiers_ro")
      .select(
        "lead_id, submission_ready, nhs_submission_status, nhs_submission_date, dossier_status, updated_at, doc_medical_report, doc_undue_delay_letter, doc_s2_provider_declaration, doc_detailed_medical_estimate",
      )
      .limit(10000);
    dossiers = (data ?? []) as DossierRow[];
  } catch {
    /* view unreachable — dossier-based tiles stay at 0 */
  }

  const clinicDocs = { medical_report: 0, undue_delay_letter: 0, s2_provider_declaration: 0, medical_estimate: 0 };
  const tracking = { submitted: 0, in_review: 0, accepted: 0, rejected: 0 };
  let readyToSubmit = 0;
  let submittedThisMonth = 0;
  let pending3d = 0;
  for (const d of dossiers) {
    if (truthyDoc(d.doc_medical_report)) clinicDocs.medical_report += 1;
    if (truthyDoc(d.doc_undue_delay_letter)) clinicDocs.undue_delay_letter += 1;
    if (truthyDoc(d.doc_s2_provider_declaration)) clinicDocs.s2_provider_declaration += 1;
    if (truthyDoc(d.doc_detailed_medical_estimate)) clinicDocs.medical_estimate += 1;

    const submitted = Boolean(d.nhs_submission_date) || Boolean(d.nhs_submission_status?.trim());
    const status = (d.nhs_submission_status ?? "").toLowerCase();
    if (submitted) tracking.submitted += 1;
    if (/review|pending|instruction|examen/.test(status)) tracking.in_review += 1;
    if (/accept|approv/.test(status)) tracking.accepted += 1;
    if (/refus|reject/.test(status)) tracking.rejected += 1;

    if (d.submission_ready && !submitted) readyToSubmit += 1;
    if (d.nhs_submission_date && d.nhs_submission_date >= monthStart) submittedThisMonth += 1;

    // "Sans réponse 3j+" — dossier ouvert (non soumis, non complet) sans
    // aucune mise à jour depuis 3 jours.
    const updatedMs = d.updated_at ? new Date(d.updated_at).getTime() : NaN;
    const isComplete = /complet|complete|all_/i.test(d.dossier_status ?? "");
    if (!submitted && !isComplete && Number.isFinite(updatedMs) && updatedMs < threeDaysAgoMs) {
      pending3d += 1;
    }
  }

  // ── Bloqués 5j+ — dossiers partiels (docs manquants) sans activité ─────
  const stalledPatients: NhsStalledPatient[] = [];
  try {
    const { data } = await legacy
      .from("leads_rdv")
      .select(
        "nom, numero_telephone, email, qualification, received_documents, last_doc_chase_at, last_response_date, relance_email_date, relance_whatsapp_date, last_call_datetime, last_updated, document_status",
      )
      .or("document_status.ilike.%missing%,document_status.ilike.%partial%,document_status.ilike.%partiel%")
      .limit(2000);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const stamps = [
        r["last_doc_chase_at"], r["last_response_date"], r["relance_email_date"],
        r["relance_whatsapp_date"], r["last_call_datetime"], r["last_updated"],
      ]
        .map((v) => (v ? new Date(String(v)).getTime() : NaN))
        .filter((ms) => Number.isFinite(ms)) as number[];
      const lastMs = stamps.length ? Math.max(...stamps) : null;
      if (lastMs !== null && lastMs >= fiveDaysAgoMs) continue; // active recently
      const received = String(r["received_documents"] ?? "")
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean).length;
      stalledPatients.push({
        name: (r["nom"] as string | null) ?? null,
        phone: (r["numero_telephone"] as string | null) ?? null,
        email: (r["email"] as string | null) ?? null,
        docs_filled: received,
        docs_total: DOCS_TOTAL,
        qualification: (r["qualification"] as string | null) ?? null,
        last_activity: lastMs === null ? null : new Date(lastMs).toISOString(),
        days_stalled: lastMs === null ? null : Math.floor((now.getTime() - lastMs) / 86400_000),
      });
    }
  } catch {
    /* leads unreachable — empty list */
  }
  stalledPatients.sort((a, b) => {
    const am = a.last_activity ? new Date(a.last_activity).getTime() : -Infinity;
    const bm = b.last_activity ? new Date(b.last_activity).getTime() : -Infinity;
    return am - bm;
  });

  // ── Files coordinateurs (Summer / Rain / Stormi) ───────────────────────
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
      if (!a.lead_id || latestPerLead.has(a.lead_id)) continue; // first = latest
      latestPerLead.set(a.lead_id, a);
    }
    const open = [...latestPerLead.values()].filter(
      (a) => a.assigned_to && (!a.status || a.status === "open"),
    );
    const ids = open.map((a) => a.lead_id);
    const leadById = new Map<string, { nom: string | null; numero_telephone: string | null }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: leadRows } = await legacy
        .from("leads_rdv")
        .select("id, nom, numero_telephone")
        .in("id", ids.slice(i, i + 200));
      for (const l of (leadRows ?? []) as Array<{ id: string; nom: string | null; numero_telephone: string | null }>) {
        leadById.set(String(l.id), { nom: l.nom, numero_telephone: l.numero_telephone });
      }
    }
    for (const a of open) {
      const queue = queues.get((a.assigned_to ?? "").trim().toLowerCase());
      if (!queue) continue;
      const lead = leadById.get(String(a.lead_id));
      queue.patients.push({
        name: lead?.nom ?? null,
        phone: lead?.numero_telephone ?? null,
        assigned_at: a.assigned_at,
        reason: a.reason,
      });
    }
  } catch {
    /* assignments unreachable — empty queues */
  }

  const body: NhsSuiviResponse = {
    has_data: hasData,
    monthly_objective: MONTHLY_OBJECTIVE,
    submitted_this_month: submittedThisMonth,
    pending_response_3d_plus: pending3d,
    ready_to_submit: readyToSubmit,
    stalled: { count: stalledPatients.length, patients: stalledPatients.slice(0, 100) },
    coordinators: COORDINATORS.map((n) => queues.get(n.toLowerCase())!),
    clinic_docs: clinicDocs,
    comms: {
      email_j0_sent: emailJ0,
      email_j2_sent: emailJ2,
      whatsapp_sent: whatsapp,
      responses_received: responses,
    },
    file_status: {
      no_document: noDocument,
      partial: partialDocs,
      complete: completeDocs,
      no_response_3d: pending3d,
    },
    nhs_tracking: tracking,
    pipeline: {
      initial_call: initialCall,
      email_reminder: emailJ2,
      response_received: responses,
      file_complete: completeDocs,
      nhs_submitted: tracking.submitted,
    },
  };
  return NextResponse.json(body);
}
