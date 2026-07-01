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
//      qualified patient, each tagged with any existing notification rows
//      for that date (one per channel: pending/sent/failed/rejected).
// POST { date, decisions: [{ lead_id, channels: ["sms","whatsapp"] }] } →
//      sends the notice via each requested channel (both can be picked for
//      the same patient), upserts a row per channel with the outcome.
//      Patients omitted from `decisions` are left untouched (Summer can
//      call this multiple times through the evening).

export type ValidationNotification = {
  channel: NotificationChannel;
  status: "pending" | "sent" | "failed" | "rejected";
  sent_at: string | null;
  error: string | null;
};

export type ValidationCandidate = {
  lead_id: string;
  nom: string | null;
  numero_telephone: string | null;
  qualification: string | null;
  last_qualification_update: string | null;
  note: string | null;
  reason: string | null;
  notifications: ValidationNotification[];
};

export type RainValidationResponse = {
  target_date: string;
  candidates: ValidationCandidate[];
  callback_number: string;
  generated_at: string;
};

function summarizeReason(note: string | null, callOutcome: string | null, missingDocuments: string | null): string | null {
  const parts = [note, callOutcome, missingDocuments].map((v) => (v ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? parts[0] : null;
}

export async function GET(req: Request) {
  await requestOrgId(req);
  const sb = supabaseServer();

  const { searchParams } = new URL(req.url);
  const targetDate = searchParams.get("date");
  if (!targetDate) return NextResponse.json({ error: "date required" }, { status: 400 });

  const { data: leads, error } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone, qualification, last_qualification_update, note, call_outcome, missing_documents")
    .eq("qualification", "A PASSER A L'HUMAIN")
    .eq("do_not_call", false)
    .order("last_qualification_update", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leadIds = (leads ?? []).map((l) => l.id);
  const notifsByLead = new Map<string, ValidationNotification[]>();
  if (leadIds.length > 0) {
    const { data: notifs } = await sb
      .from("rain_call_notifications")
      .select("lead_id, channel, status, sent_at, error")
      .eq("target_date", targetDate)
      .in("lead_id", leadIds);
    for (const n of notifs ?? []) {
      const list = notifsByLead.get(n.lead_id) ?? [];
      list.push({ channel: n.channel, status: n.status as ValidationNotification["status"], sent_at: n.sent_at, error: n.error });
      notifsByLead.set(n.lead_id, list);
    }
  }

  const candidates: ValidationCandidate[] = (leads ?? []).map((l) => ({
    lead_id: l.id,
    nom: l.nom,
    numero_telephone: l.numero_telephone,
    qualification: l.qualification,
    last_qualification_update: l.last_qualification_update,
    note: l.note,
    reason: summarizeReason(l.note, l.call_outcome, l.missing_documents),
    notifications: notifsByLead.get(l.id) ?? [],
  }));

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
    decisions?: { lead_id: string; channels: NotificationChannel[] }[];
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

  const results: { lead_id: string; channel: NotificationChannel; ok: boolean; error?: string }[] = [];

  for (const d of decisions) {
    const lead = leadById.get(d.lead_id);
    for (const channel of d.channels ?? []) {
      if (!lead || !lead.numero_telephone) {
        results.push({ lead_id: d.lead_id, channel, ok: false, error: "lead introuvable ou sans téléphone" });
        continue;
      }

      const sendResult = await sendRainNotice(lead.numero_telephone, lead.nom, channel, RAIN_CALLBACK_NUMBER);

      await sb.from("rain_call_notifications").upsert(
        {
          lead_id: d.lead_id,
          target_date: targetDate,
          channel,
          status: sendResult.ok ? "sent" : "failed",
          twilio_sid: sendResult.sid ?? null,
          error: sendResult.ok ? null : (sendResult.error ?? "échec inconnu").slice(0, 500),
          validated_at: new Date().toISOString(),
          sent_at: sendResult.ok ? new Date().toISOString() : null,
        },
        { onConflict: "lead_id,target_date,channel" },
      );

      results.push({ lead_id: d.lead_id, channel, ok: sendResult.ok, error: sendResult.ok ? undefined : sendResult.error });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
