import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";
import { fetchTwilioRecordingUrl } from "@/lib/twilio-recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAIN_HANDLE_ID = "a855a4d9-9871-46bb-a109-2abb737d95c3";

export type RainCallDetail = {
  call_id: string | null;
  started_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  has_recording: boolean;
  ai_review: RainAiReview | null;
};

export type RainAiReview = {
  transcript: string;
  summary: string;
  critique: string;
  rating: "bon" | "moyen" | "insuffisant" | null;
  generated_at: string;
};

// Finds the patient's most recent call by Rain, regardless of which day is
// currently selected on the dashboard — the detail panel always shows the
// true last contact, not just today's.
export async function GET(req: Request) {
  await requestOrgId(req);
  const sb = supabaseServer();

  const { searchParams } = new URL(req.url);
  const phone = (searchParams.get("phone") ?? "").replace(/\s/g, "");
  const callIdParam = searchParams.get("call_id");

  if (!phone && !callIdParam) {
    return NextResponse.json({ error: "phone or call_id required" }, { status: 400 });
  }

  let call: {
    id: string;
    started_at: string | null;
    duration_secs: number | null;
    disposition: string | null;
    recording_url: string | null;
    metadata: Record<string, unknown> | null;
  } | null = null;

  if (callIdParam) {
    const { data } = await sb
      .from("calls")
      .select("id, started_at, duration_secs, disposition, recording_url, metadata")
      .eq("id", callIdParam)
      .maybeSingle();
    call = data;
  } else {
    const { data } = await sb
      .from("calls")
      .select("id, started_at, duration_secs, disposition, recording_url, metadata, to_e164, from_e164")
      .eq("agent_handle_id", RAIN_HANDLE_ID)
      .or(`to_e164.eq.${phone},from_e164.eq.${phone}`)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    call = data;
  }

  if (!call) {
    return NextResponse.json({
      call_id: null, started_at: null, duration_secs: null, disposition: null,
      has_recording: false, ai_review: null,
    } satisfies RainCallDetail);
  }

  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  let recordingUrl = call.recording_url;

  // Lazy backfill: the recording-status webhook may not have fired yet if
  // this is opened right after the call. Resolve directly from Twilio.
  if (!recordingUrl && typeof meta.twilio_call_sid === "string" && meta.twilio_call_sid) {
    const fetched = await fetchTwilioRecordingUrl(meta.twilio_call_sid);
    if (fetched) {
      recordingUrl = fetched;
      await sb.from("calls").update({ recording_url: fetched }).eq("id", call.id);
    }
  }

  const aiReview = (meta.rain_ai_review ?? null) as RainAiReview | null;

  return NextResponse.json({
    call_id: call.id,
    started_at: call.started_at,
    duration_secs: call.duration_secs,
    disposition: call.disposition,
    has_recording: Boolean(recordingUrl),
    ai_review: aiReview,
  } satisfies RainCallDetail);
}
