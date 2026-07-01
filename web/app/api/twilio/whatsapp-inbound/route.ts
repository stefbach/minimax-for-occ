import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio-signature";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio inbound WhatsApp webhook.
 *
 * Twilio POSTs application/x-www-form-urlencoded when a patient sends a
 * WhatsApp message to the OCC number. We persist every inbound message (text +
 * any media URLs) into whatsapp_inbound_messages and match it to a lead by
 * phone. The heavy lifting — opt-out intent classification and document
 * ingestion — is done asynchronously by Agent 9 (whatsapp_ingest_message),
 * which the "OCC — Orchestrateur WhatsApp (A9)" workflow drives off the
 * whatsapp_inbound_unprocessed view. Keeping the webhook thin means Twilio
 * always gets a fast 200 and media download / LLM calls never block delivery.
 *
 * Twilio expects a 200 with (optionally empty) TwiML.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const params = new URLSearchParams(rawBody);
  if (!validateTwilioSignature(req, params)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  const get = (k: string) => params.get(k) ?? "";
  const messageSid = get("MessageSid") || get("SmsMessageSid") || get("SmsSid");
  const fromRaw = get("From"); // e.g. "whatsapp:+447700900123"
  const toRaw = get("To");
  const body = get("Body");
  const waId = get("WaId");
  const profileName = get("ProfileName");
  const numMedia = Number(get("NumMedia") || "0") || 0;

  if (!messageSid || !fromRaw) {
    // Not a shape we can store — still ack so Twilio doesn't retry forever.
    return twiml();
  }

  const fromPhone = fromRaw.replace(/^whatsapp:/, "").trim();
  const toPhone = toRaw.replace(/^whatsapp:/, "").trim();

  // Collect media references (downloaded later by Agent 9 with Basic auth).
  const media: Array<{ url: string; content_type: string }> = [];
  for (let i = 0; i < numMedia; i++) {
    const url = get(`MediaUrl${i}`);
    if (url) media.push({ url, content_type: get(`MediaContentType${i}`) });
  }

  const sb = supabaseServer();

  // Match the sender to a lead by the national significant number (last 9
  // digits) so +44… / 07… / spaced formats all resolve to the same person.
  let leadId: string | null = null;
  const digits = fromPhone.replace(/\D/g, "");
  const last9 = digits.slice(-9);
  if (last9) {
    try {
      const { data } = await sb
        .from("leads_rdv")
        .select("id")
        .ilike("numero_telephone", `%${last9}%`)
        .limit(1);
      leadId = (data?.[0] as { id?: string } | undefined)?.id ?? null;
    } catch (e) {
      log.error(`whatsapp-inbound lead match failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Idempotent on message_sid — Twilio may retry the webhook.
  const { error } = await sb
    .from("whatsapp_inbound_messages")
    .upsert(
      {
        message_sid: messageSid,
        from_phone: fromPhone,
        to_phone: toPhone,
        wa_id: waId || null,
        profile_name: profileName || null,
        body: body || null,
        num_media: numMedia,
        media,
        lead_id: leadId,
        received_at: new Date().toISOString(),
      },
      { onConflict: "message_sid", ignoreDuplicates: true },
    );
  if (error) {
    log.error(`whatsapp-inbound store failed: ${error.message}`);
  }

  return twiml();
}

function twiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
