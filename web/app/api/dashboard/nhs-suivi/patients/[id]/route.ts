import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";
import {
  NHS_DOCS, buildPatient, buildPatientFromLead, DOSSIER_SELECT,
  type DossierRow, type LeadRow, type NhsPatient,
} from "@/lib/nhs-patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Patient detail — the [id] param is now the LEAD ID (not the dossier ID).
// We fetch the lead first, then optionally overlay the dossier. Patients
// without a dossier still get a full detail page (empty doc checklist,
// communications timeline from leads_rdv fields only).

export type NhsPatientDetail = {
  patient: NhsPatient;
  documents: Array<{ key: string; required: boolean; received: boolean }>;
  timeline: Array<{
    kind: "call" | "email" | "whatsapp" | "doc" | "response";
    date: string;
    title_key: string;
    detail: string | null;
  }>;
};

const TIMELINE_LABELS = {
  initialCall: "Appel initial",
  initialEmail: "Email explicatif envoyé",
  relanceEmail: "Email relance J+2",
  relanceWhatsapp: "WhatsApp relance J+2",
  response: "Réponse reçue du patient",
  docsAnalysed: "Analyse documents",
} as const;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requestOrgId(request);
  const { id } = await ctx.params; // this is a LEAD ID
  const legacy = nhsLegacyClient();
  try {
    // 1. Fetch lead (required — all patients start here)
    const { data: leadRow, error: lErr } = await legacy
      .from("leads_rdv")
      .select(
        'id, nom, email, numero_telephone, patient_dob, email_sent, whatsapp_sent, relance_email_sent, relance_whatsapp_sent, relance_email_date, last_response_date, last_call_datetime, last_updated, first_mail:"1st_mail"',
      )
      .eq("id", id)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!leadRow) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });
    const l = leadRow as unknown as LeadRow & { first_mail: string | null };

    // 2. Fetch dossier by lead_id (optional — may not exist yet)
    const { data: dossierRow } = await legacy
      .from("axon_nhs_dossiers_ro")
      .select(DOSSIER_SELECT)
      .eq("lead_id", id)
      .maybeSingle();
    const d = dossierRow ? (dossierRow as unknown as DossierRow) : null;

    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const patient: NhsPatient = d
      ? buildPatient(d, l, threeDaysAgo)
      : buildPatientFromLead(l, threeDaysAgo);

    // 3. Doc checklist — all pending when no dossier exists
    const documents = NHS_DOCS.map((doc) => ({
      key: doc.key,
      required: doc.required,
      received: d ? d[doc.key] === "received" : false,
    }));

    // 4. Communications timeline from leads_rdv fields (+ dossier analysis if any)
    const timeline: NhsPatientDetail["timeline"] = [];
    if (l.last_call_datetime) {
      timeline.push({ kind: "call", date: l.last_call_datetime, title_key: TIMELINE_LABELS.initialCall, detail: null });
    }
    if (l.email_sent && l.first_mail) {
      timeline.push({ kind: "email", date: l.first_mail, title_key: TIMELINE_LABELS.initialEmail, detail: null });
    }
    if (l.relance_email_sent && l.relance_email_date) {
      timeline.push({ kind: "email", date: l.relance_email_date, title_key: TIMELINE_LABELS.relanceEmail, detail: null });
    }
    if (l.relance_whatsapp_sent && l.relance_email_date) {
      timeline.push({ kind: "whatsapp", date: l.relance_email_date, title_key: TIMELINE_LABELS.relanceWhatsapp, detail: null });
    }
    if (l.last_response_date) {
      timeline.push({ kind: "response", date: l.last_response_date, title_key: TIMELINE_LABELS.response, detail: null });
    }
    if (d?.last_analysed_at) {
      timeline.push({
        kind: "doc",
        date: d.last_analysed_at,
        title_key: TIMELINE_LABELS.docsAnalysed,
        detail: `${patient.docs_received} / ${patient.docs_required}`,
      });
    }
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ patient, documents, timeline } satisfies NhsPatientDetail);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
