import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assign a patient (lead) to a coordinator queue — writes to the legacy
// dashboard_assignments table through the axon_assign_lead() function, so
// the Summer / Rain / Stormi queues stay in sync across both dashboards.

export async function POST(request: Request) {
  await requestOrgId(request); // auth context — dashboard is behind login
  let body: { lead_id?: string; assigned_to?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.lead_id || !body.assigned_to) {
    return NextResponse.json({ error: "lead_id et assigned_to requis" }, { status: 400 });
  }
  const legacy = nhsLegacyClient();
  const { error } = await legacy.rpc("axon_assign_lead", {
    p_lead_id: body.lead_id,
    p_assigned_to: body.assigned_to,
    p_reason: body.reason ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
