import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { downloadTwilioRecording, uploadRecording } from "@/lib/storage";
import { LEGACY_ORG_ID } from "@/lib/constants";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio RecordingStatusCallback webhook.
 *
 * Twilio POSTs application/x-www-form-urlencoded with at least:
 *   RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration,
 *   CallSid, AccountSid
 *
 * The `RecordingUrl` Twilio sends doesn't include a file extension; we
 * append `.mp3` to force MP3 transcoding (smaller than the default WAV).
 *
 * Side effects:
 *   - downloads the recording with Basic auth (TWILIO_ACCOUNT_SID:AUTH_TOKEN)
 *   - uploads it to Supabase Storage (axon-recordings/calls/<call_id>.mp3)
 *   - patches public.calls.recording_url with the resulting signed URL
 *   - appends a `recording_saved` row to public.call_events
 *
 * Twilio expects 200 with an empty body.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const params = new URLSearchParams(rawBody);
  if (!validateTwilioSignature(req, params)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  const get = (k: string) => params.get(k);
  const CallSid = get("CallSid");
  const RecordingSid = get("RecordingSid");
  const RecordingUrl = get("RecordingUrl");
  const RecordingDuration = get("RecordingDuration");
  const RecordingStatus = get("RecordingStatus");

  if (!CallSid || !RecordingUrl) {
    // Nothing actionable; ack so Twilio doesn't retry forever.
    return new NextResponse("", { status: 200 });
  }
  // Only act once the recording is ready (Twilio also pings on 'in-progress').
  if (RecordingStatus && RecordingStatus !== "completed") {
    return new NextResponse("", { status: 200 });
  }

  const sb = supabaseServer();

  // Find or create the public.calls row keyed by twilio_call_sid.
  let { data: call } = await sb
    .from("calls")
    .select("id, org_id")
    .eq("twilio_call_sid", CallSid)
    .maybeSingle();

  if (!call) {
    const { data: inserted, error: insErr } = await sb
      .from("calls")
      .insert({
        org_id: LEGACY_ORG_ID,
        direction: "out",
        state: "ended",
        twilio_call_sid: CallSid,
      })
      .select("id, org_id")
      .single();
    if (insErr || !inserted) {
      console.error(
        "[twilio/recording] failed to create call row:",
        insErr?.message,
      );
      return new NextResponse("", { status: 200 });
    }
    call = inserted as { id: string; org_id: string };
  }

  try {
    const { buffer, content_type } = await downloadTwilioRecording(
      `${RecordingUrl}.mp3`,
    );
    const url = await uploadRecording(buffer, {
      call_id: call.id,
      content_type: content_type || "audio/mpeg",
    });

    await sb
      .from("calls")
      .update({ recording_url: url })
      .eq("id", call.id);

    await sb.from("call_events").insert({
      call_id: call.id,
      kind: "recording_saved",
      payload: {
        duration: RecordingDuration ? Number(RecordingDuration) : null,
        recording_sid: RecordingSid,
        twilio_recording_url: RecordingUrl,
        storage_url: url,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[twilio/recording] save failed:", msg);
    await sb.from("call_events").insert({
      call_id: call.id,
      kind: "recording_save_failed",
      payload: { error: msg, twilio_recording_url: RecordingUrl },
    });
  }

  return new NextResponse("", { status: 200 });
}
