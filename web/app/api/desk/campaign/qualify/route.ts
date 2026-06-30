import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/campaign/qualify
 *   body: { campaign_id, lead_id, qualification, note? }
 *
 * After the agent has called a desk-campaign lead, they pick a qualification.
 * We stamp it on the campaign's data-table row (qualification +
 * last_qualification_update + last_call_datetime, bump call_count, append the
 * note) so the lead's status reflects the human call and it drops out of /
 * re-enters the selection accordingly.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const body = (await req.json().catch(() => null)) as {
    campaign_id?: string;
    lead_id?: string;
    qualification?: string;
    note?: string | null;
  } | null;
  const campaignId = body?.campaign_id;
  const leadId = body?.lead_id;
  const qualification = (body?.qualification ?? "").trim();
  const note = (body?.note ?? "").trim();
  if (!campaignId || !leadId) return NextResponse.json({ error: "campaign_id et lead_id requis" }, { status: 400 });
  if (!qualification || qualification.length > 64) {
    return NextResponse.json({ error: "qualification invalide" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, agent_handle_id, data_table_id")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  const { data: handle } = await admin
    .from("agent_handles")
    .select("kind, user_id")
    .eq("id", campaign.agent_handle_id as string)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!handle || handle.kind !== "human" || handle.user_id !== user.id) {
    return NextResponse.json({ error: "Campagne non assignée." }, { status: 403 });
  }
  if (!campaign.data_table_id) return NextResponse.json({ error: "pas de table" }, { status: 400 });

  const { data: dt } = await admin
    .from("tenant_data_tables")
    .select("physical_table, columns")
    .eq("id", campaign.data_table_id as string)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!dt) return NextResponse.json({ error: "table introuvable" }, { status: 404 });
  const table = dt.physical_table as string;
  const cols = new Set(((dt.columns ?? []) as Array<{ key: string }>).map((c) => c.key));

  // Read the current row (count + existing note) so we can increment/append.
  const { data: current } = await admin
    .from(table)
    .select("call_count, note")
    .eq("id", leadId)
    .maybeSingle();
  const curRow = (current ?? {}) as { call_count?: number | null; note?: string | null };

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (cols.has("qualification")) patch.qualification = qualification;
  if (cols.has("last_qualification_update")) patch.last_qualification_update = nowIso;
  if (cols.has("last_call_datetime")) patch.last_call_datetime = nowIso;
  if (cols.has("call_count")) patch.call_count = (curRow.call_count ?? 0) + 1;
  if (note && cols.has("note")) {
    const stamp = nowIso.slice(0, 16).replace("T", " ");
    patch.note = `${curRow.note ? curRow.note + "\n" : ""}[${stamp}] ${note}`.slice(0, 4000);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "aucune colonne inscriptible" }, { status: 400 });
  }

  const { error: upErr } = await admin.from(table).update(patch).eq("id", leadId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
