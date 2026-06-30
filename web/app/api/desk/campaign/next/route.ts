import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { sendContentSms } from "@/lib/twilio-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/campaign/next   body: { campaign_id, exclude?: string[] }
 *
 * Manual desk-campaign dialing: returns the NEXT lead the agent should call
 * (selected from the campaign's data table by its qualification/assignment
 * rules), and — at that moment — sends the pre-call SMS/WhatsApp if the
 * campaign has one, so the patient gets the message just before the agent
 * dials. The agent then triggers the call themselves from the softphone.
 *
 * `exclude` carries the lead ids already shown this session so we don't loop
 * back to the same person. Returns { lead: null, done: true } when the pool is
 * exhausted.
 */
interface Selection {
  status_column?: string;
  include_statuses?: string[];
  assigned_column?: string | null;
  assigned_values?: string[];
  phone_starts_with?: string;
}
interface PrecallChannel { content_sid?: string | null; from?: string | null }
interface PrecallMessage {
  enabled?: boolean;
  sms?: PrecallChannel;
  whatsapp?: PrecallChannel;
  // legacy single-channel shape
  channel?: string;
  content_sid?: string | null;
  from?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const body = (await req.json().catch(() => null)) as { campaign_id?: string; exclude?: string[] } | null;
  const campaignId = body?.campaign_id;
  if (!campaignId) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });
  const exclude = Array.isArray(body?.exclude)
    ? body!.exclude!.filter((x) => typeof x === "string" && UUID.test(x)).slice(0, 1000)
    : [];

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  // Load + authorize the campaign (must be a human handle owned by this user).
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, state, agent_handle_id, data_table_id, caller_id_e164, metadata")
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
  if (campaign.state !== "running") {
    return NextResponse.json({ lead: null, paused: true });
  }
  if (!campaign.data_table_id) return NextResponse.json({ lead: null, done: true });

  const { data: dt } = await admin
    .from("tenant_data_tables")
    .select("physical_table, phone_column, name_column, columns")
    .eq("id", campaign.data_table_id as string)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!dt) return NextResponse.json({ lead: null, done: true });
  const table = dt.physical_table as string;
  const phoneCol = dt.phone_column as string;
  const nameCol = (dt.name_column as string | null) ?? "nom";
  const cols = new Set(((dt.columns ?? []) as Array<{ key: string }>).map((c) => c.key));

  const meta = (campaign.metadata ?? {}) as { engine?: { selection?: Selection }; precall_message?: PrecallMessage };
  const sel = meta.engine?.selection ?? {};

  let q = admin.from(table).select("*");
  if (cols.has("do_not_call")) q = q.eq("do_not_call", false);
  if (cols.has("cycle_status")) q = q.eq("cycle_status", "ACTIF");
  if (sel.status_column && (sel.include_statuses?.length ?? 0) > 0) {
    q = q.in(sel.status_column, sel.include_statuses!);
  }
  if (sel.assigned_column && (sel.assigned_values?.length ?? 0) > 0) {
    q = q.in(sel.assigned_column, sel.assigned_values!);
  }
  if (sel.phone_starts_with) q = q.like(phoneCol, `${sel.phone_starts_with}%`);
  if (exclude.length > 0) q = q.not("id", "in", `(${exclude.join(",")})`);
  // Least-recently-touched first (never-called → top); the agent works fresh
  // leads before re-tries.
  if (cols.has("last_call_datetime")) q = q.order("last_call_datetime", { ascending: true, nullsFirst: true });
  q = q.limit(1);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lead = (rows ?? [])[0] as Record<string, unknown> | undefined;
  if (!lead) return NextResponse.json({ lead: null, done: true });

  const leadId = String(lead.id);
  const toE164 = String(lead[phoneCol] ?? "").trim();
  const fullName = String(lead[nameCol] ?? "").trim();
  const firstName = fullName.split(/\s+/)[0] ?? "";

  // ── Send the pre-call message(s) now (SMS and/or WhatsApp). ──────────────
  const precall = meta.precall_message ?? null;
  const messaged: string[] = [];
  const messageErrors: string[] = [];
  if (precall && precall.enabled !== false && toE164) {
    const defaultFrom = (campaign.caller_id_e164 as string | null) ?? undefined;
    const variables = firstName ? { "1": firstName } : undefined;

    const smsCfg: PrecallChannel | null =
      precall.sms ??
      (precall.content_sid && (!precall.channel || precall.channel === "sms")
        ? { content_sid: precall.content_sid, from: precall.from }
        : null);
    if (smsCfg?.content_sid) {
      const from = (smsCfg.from || defaultFrom) ?? null;
      if (from) {
        const r = await sendContentSms({ to: toE164, from, contentSid: smsCfg.content_sid, variables });
        await logMessage(admin, orgId, campaign.id as string, leadId, toE164, fullName, "sms", smsCfg.content_sid, r);
        if (r.ok) messaged.push("sms"); else messageErrors.push(`SMS: ${r.error ?? "échec"}`);
      }
    }

    const waCfg: PrecallChannel | null =
      precall.whatsapp ??
      (precall.content_sid && precall.channel === "whatsapp"
        ? { content_sid: precall.content_sid, from: precall.from }
        : null);
    if (waCfg?.content_sid) {
      const from = (waCfg.from || defaultFrom) ?? null;
      if (from) {
        const r = await sendContentSms({
          to: `whatsapp:${toE164}`,
          from: `whatsapp:${from}`,
          contentSid: waCfg.content_sid,
          variables,
        });
        await logMessage(admin, orgId, campaign.id as string, leadId, toE164, fullName, "whatsapp", waCfg.content_sid, r);
        if (r.ok) messaged.push("whatsapp"); else messageErrors.push(`WhatsApp: ${r.error ?? "échec"}`);
      }
    }
  }

  return NextResponse.json({
    lead: {
      id: leadId,
      name: fullName || null,
      phone: toE164 || null,
      qualification: (lead.qualification as string | null) ?? null,
      bmi: (lead.bmi as number | null) ?? null,
      email: (lead.email as string | null) ?? null,
      last_note:
        (lead.call_3_note as string | null) ||
        (lead.call_2_note as string | null) ||
        (lead.call_1_note as string | null) ||
        (lead.note as string | null) ||
        null,
      call_count: (lead.call_count as number | null) ?? 0,
    },
    messaged,
    message_errors: messageErrors,
  });
}

async function logMessage(
  admin: ReturnType<typeof supabaseServer>,
  orgId: string,
  campaignId: string,
  leadId: string,
  toE164: string,
  leadName: string,
  channel: string,
  contentSid: string,
  result: { ok: boolean; sid?: string; status?: string; error?: string },
) {
  try {
    await admin.from("precall_sms_log").insert({
      org_id: orgId,
      campaign_id: campaignId,
      contact_id: null,
      target_id: null,
      to_e164: toE164,
      lead_name: leadName || null,
      channel,
      content_sid: contentSid,
      twilio_sid: result.sid ?? null,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : (result.error ?? "échec").slice(0, 500),
      attempt: null,
      sent_at: new Date().toISOString(),
    });
  } catch {
    /* best-effort logging */
  }
}
