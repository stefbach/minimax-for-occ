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

  const emailJ0 = colSet.has("first_mail")
    ? await countOf((q) => q.not("first_mail", "is", null))
    : colSet.has("email_sent")
      ? await countOf((q) => q.eq("email_sent", true))
      : 0;
  const emailJ2 = colSet.has("second_mail")
    ? await countOf((q) => q.not("second_mail", "is", null))
    : 0;
  const whatsapp = colSet.has("whatsapp_sent")
    ? await countOf((q) => q.eq("whatsapp_sent", true))
    : 0;
  // "Responses received" proxy: leads with a qualification update following an
  // outbound communication. Heuristic — refined once we add a dedicated col.
  const responses = colSet.has("last_qualification_update")
    ? await countOf((q) => q.not("last_qualification_update", "is", null))
    : 0;

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
  };
}
