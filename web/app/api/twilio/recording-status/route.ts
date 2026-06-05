import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio RecordingStatusCallback webhook.
 *
 * Configured per-call in dialer/src/dial.ts when CALL_RECORDING_ENABLED is
 * true. Twilio fires this once the audio is fully processed and gives us
 * the canonical recording URL we can stream in the dashboard player.
 *
 * Payload (form-encoded):
 *   RecordingSid        - REc4f9...
 *   RecordingUrl        - https://api.twilio.com/.../Recordings/REc4f9
 *   RecordingStatus     - 'completed' | 'failed' | 'absent'
 *   RecordingDuration   - seconds
 *   CallSid             - links back to the call
 *
 * Updates calls.recording_url for the row whose metadata.twilio_call_sid
 * matches the CallSid. Twilio expects a 200 with empty body.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const params = new URLSearchParams(rawBody);
  if (!validateTwilioSignature(req, params)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }
  const callSid = params.get("CallSid");
  const recordingUrl = params.get("RecordingUrl");
  const recordingStatus = params.get("RecordingStatus");
  const recordingDuration = params.get("RecordingDuration");
  const recordingSid = params.get("RecordingSid");

  if (!callSid) return new NextResponse("", { status: 200 });
  if (recordingStatus && recordingStatus !== "completed") {
    // Failed / absent / in-progress — nothing playable to store yet.
    return new NextResponse("", { status: 200 });
  }
  if (!recordingUrl) return new NextResponse("", { status: 200 });

  const sb = supabaseServer();

  // Twilio's RecordingUrl is the metadata URL — append .mp3 (or .wav) to
  // get a directly playable audio stream. mp3 is fine for the dashboard
  // <audio> element and is the default Twilio format.
  const playableUrl = recordingUrl.endsWith(".mp3")
    ? recordingUrl
    : `${recordingUrl}.mp3`;

  // Find the call row by Twilio SID. The /api/twilio/status webhook stamps
  // this on the top-level column `calls.twilio_call_sid` (NOT in metadata —
  // an earlier audit caught this mismatch which was dropping recordings).
  // We still order by started_at desc to break ties if a SID is somehow
  // reused.
  const { data: rows } = await sb
    .from("calls")
    .select("id, metadata")
    .eq("twilio_call_sid", callSid)
    .order("started_at", { ascending: false })
    .limit(1);
  const row = (rows ?? [])[0] as { id: string; metadata: Record<string, unknown> | null } | undefined;
  if (!row) {
    console.warn("[recording-status] no call found for CallSid", callSid);
    return new NextResponse("", { status: 200 });
  }

  const mergedMeta = {
    ...(row.metadata ?? {}),
    recording_sid: recordingSid,
    recording_duration_secs: recordingDuration ? Number(recordingDuration) : null,
  };
  await sb
    .from("calls")
    .update({ recording_url: playableUrl, metadata: mergedMeta })
    .eq("id", row.id);

  return new NextResponse("", { status: 200 });
}
