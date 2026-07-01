import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";
import { sendRainNotice, RAIN_CALLBACK_NUMBER, type NotificationChannel } from "@/lib/rain-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Summer's end-of-day validation screen: pick which "À PASSER À L'HUMAIN"
// patients get the "Rain will call you tomorrow" notice tonight, so they
// show up (once sent) in Rain's list for that target date.
//
// GET  ?date=YYYY-MM-DD  → candidates for that date: every currently
//      qualified patient, each tagged with any existing notification row
//      for that date (pending/sent/failed/rejected) or null if untouched.
// POST { date, decisions: [{ lead_id, channel }] } → sends the notice to
//      each decision (channel = "sms" | "whatsapp"), upserts the row with
//      the outcome. Patients omitted from `decisions` are left untouched
//      (Summer can call this multiple times through the evening).

export type ValidationCandidate = {
  lead_id: string;
  nom: string | null;
  numero_telephone: string | null;
  qualification: string | null;
  last_qualification_update: string | null;
  note: string | null;
  notification: {
    channel: NotificationChannel;
    status: "pending" | "sent" | "failed" | "rejected";
    sent_at: string | null;
    error: string | null;
  } | null;
};

export type RainValidationResponse = {
  target_date: string;
  candidates: ValidationCandidate[];
  callback_number: string;
  generated_at: string;
};

export async function GET(req: Request) {
  await requestOrgId(req);
  const sb = supabaseServer();

  const { searchParams } = new URL(req.url);
  const targetDate = searchParams.get("date");
  if (!targetDate) return NextResponse.json({ error: "date required" }, { status: 400 });

  const { data: leads, error } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone, qualification, last_qualification_update, note")
    .eq("qualification", "A PASSER A L'HUMAIN")
    .eq("do_not_call", false)
    .order("last_qualification_update", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadIds = (leads ?? []).map((l) => l.id);
  const notifByLead = new Map<string, { channel: NotificationChannel; status: string; sent_at: string | null; error: string | null }>();
  if (leadIds.length > 0) {
    const { data: notifs } = await sb
      .from("rain_call_notifications")
      .select("lead_id, channel, status, sent_at, error")
      .eq("target_date", targetDate)
      .in("lead_id", leadIds);
    for (const n of notifs ?? []) {
      notifByLead.set(n.lead_id, { channel: n.channel, status: n.status, sent_at: n.sent_at, error: n.error });
    }
  }

  const candidates: ValidationCandidate[] = (leads ?? []).map((l) => {
    const n = notifByLead.get(l.id);
    return {
      lead_id: l.id,
      nom: l.nom,
      numero_telephone: l.numero_telephone,
      qualification: l.qualification,
      last_qualification_update: l.last_qualification_update,
      note: l.note,
      notification: n
        ? { channel: n.channel, status: n.status as "pending" | "sent" | "failed" | "rejected", sent_at: n.sent_at, error: n.error }
        : null,
    };
  });

  return NextResponse.json({
    target_date: targetDate,
    candidates,
    callback_number: RAIN_CALLBACK_NUMBER,
    generated_at: new Date().toISOString(),
  } satisfies RainValidationResponse);
}

export async function POST(req: Request) {
  await requestOrgId(req);
  const sb = supabaseServer();

  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    decisions?: { lead_id: string; channel: NotificationChannel }[];
  };
  const targetDate = body.date;
  const decisions = body.decisions ?? [];
  if (!targetDate) return NextResponse.json({ error: "date required" }, { status: 400 });
  if (decisions.length === 0) return NextResponse.json({ error: "no decisions" }, { status: 400 });

  const leadIds = decisions.map((d) => d.lead_id);
  const { data: leads, error } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone")
    .in("id", leadIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));

  const results: { lead_id: string; ok: boolean; error?: string }[] = [];

  for (const d of decisions) {
    const lead = leadById.get(d.lead_id);
    if (!lead || !lead.numero_telephone) {
      results.push({ lead_id: d.lead_id, ok: false, error: "lead introuvable ou sans téléphone" });
      continue;
    }

    const sendResult = await sendRainNotice(lead.numero_telephone, lead.nom, d.channel, RAIN_CALLBACK_NUMBER);

    await sb.from("rain_call_notifications").upsert(
      {
        lead_id: d.lead_id,
        target_date: targetDate,
        channel: d.channel,
        status: sendResult.ok ? "sent" : "failed",
        twilio_sid: sendResult.sid ?? null,
        error: sendResult.ok ? null : (sendResult.error ?? "échec inconnu").slice(0, 500),
        validated_at: new Date().toISOString(),
        sent_at: sendResult.ok ? new Date().toISOString() : null,
      },
      { onConflict: "lead_id,target_date" },
    );

    results.push({ lead_id: d.lead_id, ok: sendResult.ok, error: sendResult.ok ? undefined : sendResult.error });
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
