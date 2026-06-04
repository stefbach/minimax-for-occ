import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suivi patient NHS S2 — pipeline panel for the OCC weight management
// programme (clones the OCC demo dashboard, fed by lime-window data).
//
// The endpoint locates the org's lead-tracking table via tenant_data_tables
// (any physical_table whose label/key matches /leads_rdv|leads.*rdv|nhs/i)
// and computes the dashboard counts from it. Returns zeros when the table
// isn't registered yet (multi-tenant safe — no hardcoded names).

export type NhsSuiviResponse = {
  has_data: boolean;
  monthly_objective: number;
  submitted_this_month: number;
  pending_response_3d_plus: number;
  ready_to_submit: number;
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

const MONTHLY_OBJECTIVE = Number(process.env.NHS_MONTHLY_OBJECTIVE ?? 30);

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const sb = supabaseServer();

  // Locate the leads table for this org. We prefer a table whose label/key
  // suggests NHS / RDV tracking; otherwise fall back to the first registered.
  const { data: tables } = await sb
    .from("tenant_data_tables")
    .select("physical_table, label")
    .eq("org_id", orgId);
  const candidate =
    (tables ?? []).find((t) =>
      /leads_rdv|nhs|patient/i.test((t as { label: string }).label ?? "") ||
      /leads_rdv|nhs|patient/i.test((t as { physical_table: string }).physical_table ?? ""),
    ) ?? (tables ?? [])[0];
  if (!candidate) {
    return NextResponse.json(zeros());
  }
  const table = (candidate as { physical_table: string }).physical_table;

  // Defensive: confirm the table has the columns we'd need.
  const { data: cols } = await sb
    .from("information_schema.columns" as any)
    .select("column_name")
    .eq("table_name", table);
  const colSet = new Set((cols ?? []).map((c) => (c as { column_name: string }).column_name));
  if (!colSet.has("nhs_wmp_status") && !colSet.has("qualification")) {
    return NextResponse.json(zeros());
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400_000).toISOString();

  const countOf = async (build: (q: any) => any): Promise<number> => {
    try {
      const { count } = await build(sb.from(table).select("id", { count: "exact", head: true }));
      return count ?? 0;
    } catch {
      return 0;
    }
  };

  // Submitted this month: nhs_wmp_status ~ 'submitted'/'soumis' and updated this month.
  const submittedThisMonth = colSet.has("nhs_wmp_status")
    ? await countOf((q) =>
        q.gte("updated_at", monthStart).ilike("nhs_wmp_status", "%submi%"),
      )
    : 0;

  // Pending 3d+: last contact > 3 days ago and not closed/submitted.
  const pending3d = colSet.has("last_call_datetime")
    ? await countOf((q) =>
        q
          .lt("last_call_datetime", threeDaysAgo)
          .not("nhs_wmp_status", "ilike", "%submi%")
          .not("qualification", "ilike", "%refus%")
          .not("qualification", "ilike", "%rdv confirm%"),
      )
    : 0;

  // Ready to submit: confirmed appointment + clinical info filled, not submitted yet.
  const readyToSubmit = colSet.has("qualification")
    ? await countOf((q) => {
        let qq = q.ilike("qualification", "%confirm%");
        if (colSet.has("nhs_wmp_status")) qq = qq.not("nhs_wmp_status", "ilike", "%submi%");
        if (colSet.has("bmi")) qq = qq.gte("bmi", 30);
        if (colSet.has("allergies")) qq = qq.not("allergies", "is", null);
        return qq;
      })
    : 0;

  // OCC production names the J0 and J+2 email columns `1st_mail` / `2nd_mail`
  // (yes, identifiers starting with a digit — they're quoted in SQL). We also
  // accept the demo names `first_mail` / `second_mail` so the dashboard still
  // works on legacy tables that haven't been migrated.
  const mailJ0Col = colSet.has("1st_mail") ? "1st_mail" : colSet.has("first_mail") ? "first_mail" : null;
  const mailJ2Col = colSet.has("2nd_mail") ? "2nd_mail" : colSet.has("second_mail") ? "second_mail" : null;

  const emailJ0 = mailJ0Col
    ? await countOf((q) => q.not(mailJ0Col, "is", null))
    : colSet.has("email_sent")
      ? await countOf((q) => q.eq("email_sent", true))
      : 0;
  const emailJ2 = mailJ2Col
    ? await countOf((q) => q.not(mailJ2Col, "is", null))
    : colSet.has("relance_email_sent")
      ? await countOf((q) => q.eq("relance_email_sent", true))
      : 0;
  const whatsapp = colSet.has("whatsapp_sent")
    ? await countOf((q) => q.eq("whatsapp_sent", true))
    : 0;
  // "Responses received" proxy: leads with a qualification update following an
  // outbound communication. Heuristic — refined once we add a dedicated col.
  const responses = colSet.has("last_qualification_update")
    ? await countOf((q) => q.not("last_qualification_update", "is", null))
    : 0;

  // ── File status (4 tuiles) ─────────────────────────────────────────────
  // "Aucun document" — initial email sent (1st_mail / first_mail) but no
  // doc-tracking columns filled. On OCC prod, `document_status` already tracks
  // this explicitly; prefer that signal when present.
  const noDocument = colSet.has("document_status")
    ? await countOf((q) => q.or("document_status.is.null,document_status.ilike.%aucun%"))
    : mailJ0Col
      ? await countOf((q) => {
          let qq = q.not(mailJ0Col, "is", null);
          if (colSet.has("nhs_wmp_status")) qq = qq.is("nhs_wmp_status", null);
          if (colSet.has("nhs_wmp_details")) qq = qq.is("nhs_wmp_details", null);
          return qq;
        })
      : 0;

  // "Documents partiels" — at least one of the 3 clinical cols filled but
  // not all of them. Approximated with: past_surgeries NOT NULL XOR meds NOT
  // NULL XOR allergies NOT NULL (i.e. not the trivially-empty leads and not
  // the fully-complete ones). We query the 4 "exactly one filled" cases plus
  // the 3 "exactly two filled" cases via a single fetch with a partial check.
  // For tractability we fetch the small set of (id, past_surgeries,
  // current_medications, allergies) rows and bucket them in memory.
  let partialDocs = 0;
  let completeDocs = 0;
  if (colSet.has("past_surgeries") || colSet.has("current_medications") || colSet.has("allergies")) {
    try {
      const cols = [
        colSet.has("past_surgeries") ? "past_surgeries" : null,
        colSet.has("current_medications") ? "current_medications" : null,
        colSet.has("allergies") ? "allergies" : null,
        colSet.has("bmi") ? "bmi" : null,
        colSet.has("patient_dob") ? "patient_dob" : null,
      ].filter(Boolean) as string[];
      const { data } = await sb.from(table).select(cols.join(",")).limit(20000);
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      for (const r of rows) {
        const ps = colSet.has("past_surgeries") ? r["past_surgeries"] : undefined;
        const cm = colSet.has("current_medications") ? r["current_medications"] : undefined;
        const al = colSet.has("allergies") ? r["allergies"] : undefined;
        const bmi = colSet.has("bmi") ? r["bmi"] : undefined;
        const dob = colSet.has("patient_dob") ? r["patient_dob"] : undefined;
        const filled = [ps, cm, al].filter((v) => v !== null && v !== undefined && v !== "").length;
        const totalClinical = [
          colSet.has("past_surgeries"),
          colSet.has("current_medications"),
          colSet.has("allergies"),
        ].filter(Boolean).length;
        if (filled > 0 && filled < totalClinical) partialDocs += 1;
        // Complete = bmi, dob, allergies, current_medications, past_surgeries all filled
        const isComplete =
          (!colSet.has("bmi") || (bmi !== null && bmi !== undefined && bmi !== "")) &&
          (!colSet.has("patient_dob") || (dob !== null && dob !== undefined && dob !== "")) &&
          (!colSet.has("allergies") || (al !== null && al !== undefined && al !== "")) &&
          (!colSet.has("current_medications") || (cm !== null && cm !== undefined && cm !== "")) &&
          (!colSet.has("past_surgeries") || (ps !== null && ps !== undefined && ps !== ""));
        if (isComplete && colSet.has("bmi") && colSet.has("patient_dob") && colSet.has("allergies") && colSet.has("current_medications") && colSet.has("past_surgeries")) {
          completeDocs += 1;
        }
      }
    } catch {
      partialDocs = 0;
      completeDocs = 0;
    }
  }

  // "Sans réponse 3j+" — same as pending3d (escalation proxy).
  const noResponse3d = pending3d;

  // ── NHS tracking (4 tuiles) ────────────────────────────────────────────
  const nhsSubmitted = colSet.has("nhs_wmp_status")
    ? await countOf((q) => q.or("nhs_wmp_status.ilike.%submi%,nhs_wmp_status.ilike.%envoye%"))
    : 0;
  const nhsInReview = colSet.has("nhs_wmp_status")
    ? await countOf((q) => q.or("nhs_wmp_status.ilike.%review%,nhs_wmp_status.ilike.%pending%"))
    : 0;
  const nhsAccepted = colSet.has("nhs_wmp_status")
    ? await countOf((q) => q.or("nhs_wmp_status.ilike.%accept%,nhs_wmp_status.ilike.%approv%"))
    : 0;
  const nhsRejected = colSet.has("nhs_wmp_status")
    ? await countOf((q) => q.or("nhs_wmp_status.ilike.%refus%,nhs_wmp_status.ilike.%reject%"))
    : 0;

  // ── Pipeline (5 étapes) ────────────────────────────────────────────────
  const stepInitialCall = colSet.has("last_call_datetime")
    ? await countOf((q) => q.not("last_call_datetime", "is", null))
    : 0;
  const stepEmailReminder = mailJ2Col
    ? await countOf((q) => q.not(mailJ2Col, "is", null))
    : colSet.has("relance_email_sent")
      ? await countOf((q) => q.eq("relance_email_sent", true))
      : 0;
  // "Réponse reçue" proxy: OCC prod tracks the actual response timestamp in
  // `last_response_date`. When present, that's the strongest signal. Fall back
  // to last_qualification_update + email-sent heuristic for legacy tables.
  const stepResponseReceived = colSet.has("last_response_date")
    ? await countOf((q) => q.not("last_response_date", "is", null))
    : colSet.has("last_qualification_update") && mailJ0Col
      ? await countOf((q) =>
          q.not("last_qualification_update", "is", null).not(mailJ0Col, "is", null),
        )
      : colSet.has("last_qualification_update")
        ? await countOf((q) => q.not("last_qualification_update", "is", null))
        : 0;
  const stepFileComplete = completeDocs;
  const stepNhsSubmitted = nhsSubmitted;

  const body: NhsSuiviResponse = {
    has_data: true,
    monthly_objective: MONTHLY_OBJECTIVE,
    submitted_this_month: submittedThisMonth,
    pending_response_3d_plus: pending3d,
    ready_to_submit: readyToSubmit,
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
      no_response_3d: noResponse3d,
    },
    nhs_tracking: {
      submitted: nhsSubmitted,
      in_review: nhsInReview,
      accepted: nhsAccepted,
      rejected: nhsRejected,
    },
    pipeline: {
      initial_call: stepInitialCall,
      email_reminder: stepEmailReminder,
      response_received: stepResponseReceived,
      file_complete: stepFileComplete,
      nhs_submitted: stepNhsSubmitted,
    },
  };
  return NextResponse.json(body);
}

function zeros(): NhsSuiviResponse {
  return {
    has_data: false,
    monthly_objective: MONTHLY_OBJECTIVE,
    submitted_this_month: 0,
    pending_response_3d_plus: 0,
    ready_to_submit: 0,
    comms: { email_j0_sent: 0, email_j2_sent: 0, whatsapp_sent: 0, responses_received: 0 },
    file_status: { no_document: 0, partial: 0, complete: 0, no_response_3d: 0 },
    nhs_tracking: { submitted: 0, in_review: 0, accepted: 0, rejected: 0 },
    pipeline: {
      initial_call: 0,
      email_reminder: 0,
      response_received: 0,
      file_complete: 0,
      nhs_submitted: 0,
    },
  };
}
