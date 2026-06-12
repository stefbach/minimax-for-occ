import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";
import {
  NHS_DOCS, buildPatient, DOSSIER_SELECT,
  type DossierRow, type LeadRow, type NhsPatient,
} from "@/lib/nhs-patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Patient detail — port of the legacy /api/nhs-patients/[id]: dossier +
// lead, the 11-document checklist and the communications timeline.

export type NhsPatientDetail = {
  patient: NhsPatient;
  documents: Array<{ key: string; required: boolean; received: boolean }>;
  timeline: Array<{
    kind: "call" | "email" | "whatsapp" | "doc" | "response";
    date: string;
    title_key: string; // i18n FR label key (matches lib/i18n.tsx entries)
    detail: string | null;
  }>;
};

// Legacy timeline keys → FR labels used as i18n keys in the new app.
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
  const { id } = await ctx.params;
  const legacy = nhsLegacyClient();
  try {
    const { data: dossier, error: dErr } = await legacy
      .from("axon_nhs_dossiers_ro")
      .select(DOSSIER_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (dErr) throw dErr;
    if (!dossier) return NextResponse.json({ error: "Dossier introuvable" }, { status: 404 });
    const d = dossier as unknown as DossierRow;
    if (!d.lead_id) return NextResponse.json({ error: "Dossier sans lead" }, { status: 400 });

    const { data: leadRow, error: lErr } = await legacy
      .from("leads_rdv")
      .select(
        'id, nom, email, numero_telephone, patient_dob, email_sent, whatsapp_sent, relance_email_sent, relance_whatsapp_sent, relance_email_date, last_response_date, last_call_datetime, last_updated, first_mail:"1st_mail"',
      )
      .eq("id", d.lead_id)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!leadRow) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });
    const l = leadRow as unknown as LeadRow & { first_mail: string | null };

    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const patient = buildPatient(d, l, threeDaysAgo);

    const documents = NHS_DOCS.map((doc) => ({
      key: doc.key,
      required: doc.required,
      received: d[doc.key] === "received",
    }));

    const timeline: NhsPatientDetail["timeline"] = [];
    if (l.last_call_datetime) {
      timeline.push({ kind: "call", date: l.last_call_datetime, title_key: TIMELINE_LABELS.initialCall, detail: null });
    }
    // The legacy "1st_mail" column carries the J0 send timestamp.
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
    if (d.last_analysed_at) {
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
