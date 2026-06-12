import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drill-down behind every card of the Suivi NHS S2 tab — returns the actual
// patients a tile counted so the operator can verify the figure. One endpoint,
// one `metric` param; same legacy data source as /api/dashboard/nhs-suivi.

export type NhsDrillRow = {
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null; // metric-specific detail (qualification, doc status…)
  date: string | null;   // metric-specific timestamp
};

export type NhsDrillResponse = {
  metric: string;
  total: number;
  rows: NhsDrillRow[]; // capped at 200, most recent first
};

const LIMIT = 200;

type LeadRow = Record<string, unknown>;
type DossierRow = {
  lead_id: string | null;
  nom: string | null;
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

function truthyDoc(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s !== "" && !/^(false|no|non|0|pending|missing)$/i.test(s);
}

const LEAD_COLS =
  "nom, numero_telephone, email, qualification, document_status, missing_documents, first_email_at, relance_email_date, relance_whatsapp_date, last_response_date, last_updated";

// Lead-based metrics: filter builder + which columns feed status/date.
const LEAD_METRICS: Record<
  string,
  { filter: (q: any) => any; status: (r: LeadRow) => string | null; date: keyof LeadRow }
> = {
  email_j0: {
    filter: (q) => q.eq("email_sent", true),
    status: (r) => (r["qualification"] as string | null) ?? null,
    date: "first_email_at",
  },
  email_j2: {
    filter: (q) => q.eq("relance_email_sent", true),
    status: (r) => (r["qualification"] as string | null) ?? null,
    date: "relance_email_date",
  },
  whatsapp_j2: {
    filter: (q) => q.eq("relance_whatsapp_sent", true),
    status: (r) => (r["qualification"] as string | null) ?? null,
    date: "relance_whatsapp_date",
  },
  responses: {
    filter: (q) => q.not("last_response_date", "is", null),
    status: (r) => (r["qualification"] as string | null) ?? null,
    date: "last_response_date",
  },
  no_document: {
    filter: (q) =>
      q.eq("email_sent", true).or(
        "document_status.is.null,document_status.ilike.%no_document%,document_status.ilike.%aucun%",
      ),
    status: (r) => (r["document_status"] as string | null) ?? "AUCUN DOCUMENT",
    date: "first_email_at",
  },
  partial: {
    filter: (q) =>
      q.or("document_status.ilike.%missing%,document_status.ilike.%partial%,document_status.ilike.%partiel%"),
    status: (r) => {
      const missing = (r["missing_documents"] as string | null)?.trim();
      return missing ? `Manquants : ${missing}` : ((r["document_status"] as string | null) ?? null);
    },
    date: "last_updated",
  },
  complete: {
    filter: (q) => q.in("document_status", ["COMPLETE", "COMPLET", "ALL_DOCUMENTS_RECEIVED", "ALL_RECEIVED"]),
    status: (r) => (r["document_status"] as string | null) ?? null,
    date: "last_updated",
  },
};

// Dossier-based metrics: predicate over the read-only view's rows.
const DOSSIER_METRICS: Record<
  string,
  { match: (d: DossierRow, ctx: { monthStart: string; threeDaysAgoMs: number }) => boolean; status: (d: DossierRow) => string | null }
> = {
  submitted_month: {
    match: (d, c) => Boolean(d.nhs_submission_date && d.nhs_submission_date >= c.monthStart),
    status: (d) => d.nhs_submission_status ?? "Soumis",
  },
  pending_3d: {
    match: (d, c) => {
      const submitted = Boolean(d.nhs_submission_date) || Boolean(d.nhs_submission_status?.trim());
      const complete = /complet|complete|all_/i.test(d.dossier_status ?? "");
      const ms = d.updated_at ? new Date(d.updated_at).getTime() : NaN;
      return !submitted && !complete && Number.isFinite(ms) && ms < c.threeDaysAgoMs;
    },
    status: (d) => d.dossier_status,
  },
  ready: {
    match: (d) =>
      Boolean(d.submission_ready) && !(Boolean(d.nhs_submission_date) || Boolean(d.nhs_submission_status?.trim())),
    status: (d) => d.dossier_status ?? "Prêt",
  },
  sent_nhs: {
    match: (d) => Boolean(d.nhs_submission_date) || Boolean(d.nhs_submission_status?.trim()),
    status: (d) => d.nhs_submission_status ?? "Soumis",
  },
  in_review: {
    match: (d) => /review|pending|instruction|examen/i.test(d.nhs_submission_status ?? ""),
    status: (d) => d.nhs_submission_status,
  },
  accepted: {
    match: (d) => /accept|approv/i.test(d.nhs_submission_status ?? ""),
    status: (d) => d.nhs_submission_status,
  },
  rejected: {
    match: (d) => /refus|reject/i.test(d.nhs_submission_status ?? ""),
    status: (d) => d.nhs_submission_status,
  },
  doc_medical_report: { match: (d) => truthyDoc(d.doc_medical_report), status: (d) => "Généré" },
  doc_undue_delay: { match: (d) => truthyDoc(d.doc_undue_delay_letter), status: (d) => "Générée" },
  doc_s2_declaration: { match: (d) => truthyDoc(d.doc_s2_provider_declaration), status: (d) => "Signée" },
  doc_estimate: { match: (d) => truthyDoc(d.doc_detailed_medical_estimate), status: (d) => "Devis émis" },
};

export async function GET(request: Request) {
  await requestOrgId(request); // auth context — dashboard is behind login
  const { searchParams } = new URL(request.url);
  const metric = searchParams.get("metric") ?? "";
  const legacy = nhsLegacyClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const threeDaysAgoMs = now.getTime() - 3 * 86400_000;

  // ── Lead-based metrics ──────────────────────────────────────────────────
  const leadMetric = LEAD_METRICS[metric];
  if (leadMetric) {
    const { data, error, count } = await leadMetric.filter(
      legacy.from("leads_rdv").select(LEAD_COLS, { count: "exact" }),
    )
      .order("last_updated", { ascending: false, nullsFirst: false })
      .limit(LIMIT);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows: NhsDrillRow[] = ((data ?? []) as LeadRow[]).map((r) => ({
      name: (r["nom"] as string | null) ?? null,
      phone: (r["numero_telephone"] as string | null) ?? null,
      email: (r["email"] as string | null) ?? null,
      status: leadMetric.status(r),
      date: (r[leadMetric.date] as string | null) ?? null,
    }));
    return NextResponse.json({ metric, total: count ?? rows.length, rows } satisfies NhsDrillResponse);
  }

  // ── Dossier-based metrics ───────────────────────────────────────────────
  const dossierMetric = DOSSIER_METRICS[metric];
  if (dossierMetric) {
    const { data, error } = await legacy
      .from("axon_nhs_dossiers_ro")
      .select(
        "lead_id, nom, submission_ready, nhs_submission_status, nhs_submission_date, dossier_status, updated_at, doc_medical_report, doc_undue_delay_letter, doc_s2_provider_declaration, doc_detailed_medical_estimate",
      )
      .limit(10000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const matched = ((data ?? []) as DossierRow[]).filter((d) =>
      dossierMetric.match(d, { monthStart, threeDaysAgoMs }),
    );
    // Resolve phone/email from leads_rdv (the view only carries the name).
    const ids = matched.map((d) => d.lead_id).filter(Boolean) as string[];
    const leadById = new Map<string, { nom: string | null; numero_telephone: string | null; email: string | null }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: leads } = await legacy
        .from("leads_rdv")
        .select("id, nom, numero_telephone, email")
        .in("id", ids.slice(i, i + 200));
      for (const l of (leads ?? []) as Array<{ id: string; nom: string | null; numero_telephone: string | null; email: string | null }>) {
        leadById.set(String(l.id), l);
      }
    }
    const rows: NhsDrillRow[] = matched
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, LIMIT)
      .map((d) => {
        const lead = d.lead_id ? leadById.get(String(d.lead_id)) : undefined;
        return {
          name: d.nom ?? lead?.nom ?? null,
          phone: lead?.numero_telephone ?? null,
          email: lead?.email ?? null,
          status: dossierMetric.status(d),
          date: d.nhs_submission_date ?? d.updated_at ?? null,
        };
      });
    return NextResponse.json({ metric, total: matched.length, rows } satisfies NhsDrillResponse);
  }

  return NextResponse.json({ error: `metric inconnue: ${metric}` }, { status: 400 });
}
