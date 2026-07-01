import type { SupabaseClient } from "@supabase/supabase-js";
import { sendContentSms } from "@/lib/twilio-sms";

// "Rain va vous appeler demain" pre-call notice — sent to patients Summer
// validates the evening before, via the pre-approved Twilio Content template.
// Approved template text:
//   "Dear {{1}}, We confirm receipt of your request to speak with a member
//   of our team. {{2}} will contact you tomorrow from the following UK
//   number {{3}} to provide further assistance and next steps. If you have
//   a preferred time for this call, please reply to this message. For any
//   urgent updates, please do not hesitate to contact us. Warm regards,
//   Your Obesity Care Clinic Team"
// Variables: {{1}} patient's full name, {{2}} "Rain", {{3}} Rain's callback number.

export const RAIN_NOTICE_CONTENT_SID = "HX529091effe7b39d748f14025e394ff67";
export const RAIN_CALLBACK_NUMBER = process.env.RAIN_NOTICE_CALLBACK_NUMBER ?? "+447700162160";

export const RAIN_NOTICE_PREVIEW_TEMPLATE = (name: string) =>
  `Dear ${name},\n\nWe confirm receipt of your request to speak with a member of our team.\n\nRain will contact you tomorrow from the following UK number ${RAIN_CALLBACK_NUMBER} to provide further assistance and next steps.\n\nIf you have a preferred time for this call, please reply to this message.\n\nFor any urgent updates, please do not hesitate to contact us.\n\nWarm regards,\nYour Obesity Care Clinic Team`;

export type NotificationChannel = "sms" | "whatsapp";

export type SendResult = { ok: boolean; sid?: string; error?: string };

/** Sends the "Rain will call you tomorrow" notice via the pre-approved
 * Twilio content template, returning whether it succeeded. Does not touch
 * the DB — callers persist the outcome themselves. */
export async function sendRainNotice(
  toE164: string,
  patientName: string | null,
  channel: NotificationChannel,
  fromE164: string,
): Promise<SendResult> {
  const variables = {
    "1": (patientName ?? "").trim() || "Patient",
    "2": "Rain",
    "3": RAIN_CALLBACK_NUMBER,
  };

  const result = await sendContentSms({
    to: channel === "whatsapp" ? `whatsapp:${toE164}` : toE164,
    from: channel === "whatsapp" ? `whatsapp:${fromE164}` : fromE164,
    contentSid: RAIN_NOTICE_CONTENT_SID,
    variables,
  });

  return { ok: result.ok, sid: result.sid, error: result.error };
}

export type RainNotificationRow = {
  id: string;
  lead_id: string;
  target_date: string;
  channel: NotificationChannel;
  status: "pending" | "sent" | "failed" | "rejected";
  twilio_sid: string | null;
  error: string | null;
  validated_at: string | null;
  sent_at: string | null;
};

export async function fetchNotificationsForDate(
  sb: SupabaseClient,
  targetDate: string,
): Promise<RainNotificationRow[]> {
  const { data } = await sb
    .from("rain_call_notifications")
    .select("id, lead_id, target_date, channel, status, twilio_sid, error, validated_at, sent_at")
    .eq("target_date", targetDate);
  return (data ?? []) as RainNotificationRow[];
}
