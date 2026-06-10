import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { fetchRetellCallExtras, type TranscriptTurn } from "@/lib/retell-sync";
import { fetchTwilioRecordingUrl, findTwilioRecordingForCall } from "@/lib/twilio-recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extra detail for a single call, opened from a dashboard drill-down row. The
// row already carries the header (name, phone, time, duration, answered,
// qualification), so this only returns what the list doesn't have: the
// recording, the LLM summary and the transcript.
//
// Transcript sourcing:
//   - Native Axon calls  → call_transcripts (LiveKit STT turns).
//   - Retell calls       → metadata.transcript_turns (stored at sync time);
//     rows synced before transcript storage existed are backfilled lazily by
//     calling Retell get-call once, then cached back into metadata.

export type CallDetailTurn = { speaker: "agent" | "customer"; text: string; t?: number };
export type CallDetailResponse = {
  recording_url: string | null;
  summary: string | null;
  transcript: CallDetailTurn[];
  transcript_source: "axon" | "retell" | null;
};

type CallRow = {
  id: string;
  org_id: string;
  recording_url: string | null;
  summary: string | null;
  started_at: string | null;
  answered_at: string | null;
  to_e164: string | null;
  from_e164: string | null;
  metadata: Record<string, unknown> | null;
};

function turnsToDetail(turns: TranscriptTurn[]): CallDetailTurn[] {
  return turns.map((t) => ({
    speaker: t.role === "user" ? "customer" : "agent",
    text: t.content,
    ...(typeof t.start === "number" ? { t: Math.max(0, Math.round(t.start)) } : {}),
  }));
}

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("calls")
    .select("id, org_id, recording_url, summary, started_at, answered_at, to_e164, from_e164, metadata")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const call = data as CallRow;
  const meta = (call.metadata ?? {}) as Record<string, unknown>;

  // 1. Native Axon transcript turns (LiveKit STT). started_at per turn gives us
  // the timestamp; anchor on answered_at (talk start) else the call start.
  const { data: trData } = await sb
    .from("call_transcripts")
    .select("speaker, text, seq, started_at")
    .eq("call_id", id)
    .order("seq", { ascending: true });
  const axonTurns = (trData ?? []) as Array<{ speaker: string | null; text: string | null; started_at: string | null }>;

  let transcript: CallDetailTurn[] = [];
  let transcriptSource: "axon" | "retell" | null = null;
  let recordingUrl = call.recording_url;

  if (axonTurns.length) {
    // Anchor on the FIRST transcript turn, not answered_at: Twilio's
    // answered/in-progress timestamp can land well after the conversation
    // actually started (observed ~76s late), which would push every early turn
    // negative → all 0:00. The first turn's time is the true t=0.
    const firstTurnIso = axonTurns.find((t) => t.started_at)?.started_at ?? null;
    const anchorMs = firstTurnIso ? Date.parse(firstTurnIso)
      : call.answered_at ? Date.parse(call.answered_at)
      : call.started_at ? Date.parse(call.started_at) : NaN;
    transcript = axonTurns
      .filter((t) => t.text)
      .map((t) => {
        const turnMs = t.started_at ? Date.parse(t.started_at) : NaN;
        const rel = Number.isFinite(anchorMs) && Number.isFinite(turnMs)
          ? Math.max(0, Math.round((turnMs - anchorMs) / 1000)) : undefined;
        return {
          speaker: (t.speaker === "customer" || t.speaker === "user" ? "customer" : "agent") as "agent" | "customer",
          text: t.text as string,
          ...(rel != null ? { t: rel } : {}),
        };
      });
    transcriptSource = "axon";
  } else if (meta.source === "retell_sync") {
    transcriptSource = "retell";
    const stored = Array.isArray(meta.transcript_turns) ? (meta.transcript_turns as TranscriptTurn[]) : null;
    if (stored && stored.length) {
      transcript = turnsToDetail(stored);
    }

    // Lazy backfill from Retell — ONE get-call fills whatever's still missing
    // (recording and/or transcript, including per-turn timestamps) so older
    // rows become listenable/readable. Skip once tried, to avoid re-hammering.
    const retellId = typeof meta.retell_call_id === "string" ? meta.retell_call_id : null;
    const storedHasTime = Boolean(stored && stored.some((t) => typeof t.start === "number"));
    // Re-fetch when there's no transcript, or when we have one without per-turn
    // timestamps and haven't already learned Retell doesn't provide them.
    const needTranscript = (transcript.length === 0
      || (transcript.length > 0 && !storedHasTime && meta.transcript_no_timestamps !== true))
      && meta.transcript_unavailable !== true;
    const needRecording = !recordingUrl && meta.recording_unavailable !== true;
    if (retellId && (needTranscript || needRecording)) {
      const fetched = await fetchRetellCallExtras(retellId);
      const metaUpdate: Record<string, unknown> = { ...meta };
      let metaChanged = false;

      if (needRecording) {
        if (fetched.recording_url) {
          recordingUrl = fetched.recording_url;
        } else {
          metaUpdate.recording_unavailable = true; metaChanged = true;
        }
      }
      if (needTranscript) {
        if (fetched.turns?.length) {
          transcript = turnsToDetail(fetched.turns);
          metaUpdate.transcript_turns = fetched.turns;
          if (fetched.text) metaUpdate.transcript_text = fetched.text;
          // Remember if Retell gave no word timings, so we stop retrying.
          if (!fetched.turns.some((t) => typeof t.start === "number")) metaUpdate.transcript_no_timestamps = true;
          metaChanged = true;
        } else if (fetched.text) {
          transcript = [{ speaker: "agent", text: fetched.text }];
          metaUpdate.transcript_text = fetched.text; metaChanged = true;
        } else {
          metaUpdate.transcript_unavailable = true; metaChanged = true;
        }
      }

      // Persist the recording on its column + any metadata flags in one write.
      const colUpdate: Record<string, unknown> = {};
      if (needRecording && fetched.recording_url) colUpdate.recording_url = fetched.recording_url;
      if (metaChanged) colUpdate.metadata = metaUpdate;
      if (Object.keys(colUpdate).length) {
        await sb.from("calls").update(colUpdate).eq("id", id).eq("org_id", orgId);
      }
    }

    // Last resort: a flat transcript string with no turns.
    if (transcript.length === 0 && typeof meta.transcript_text === "string" && meta.transcript_text.trim()) {
      transcript = [{ speaker: "agent", text: meta.transcript_text }];
    }
  }

  // Recording for Twilio/Axon calls that HAVE a CallSid: resolve the trunk
  // recording via the Twilio REST API (no per-call webhook for trunk recording).
  if (!recordingUrl && typeof meta.twilio_call_sid === "string" && meta.twilio_call_sid) {
    const u = await fetchTwilioRecordingUrl(meta.twilio_call_sid);
    if (u) {
      recordingUrl = u;
      await sb.from("calls").update({ recording_url: u }).eq("id", id).eq("org_id", orgId);
    }
  }
  // Recording fallback for Axon/LiveKit calls with NO CallSid on the row: find
  // the matching Twilio call by number + start time and resolve its recording
  // (LiveKit and Twilio legs often land on separate rows). Stamp the sid so the
  // streaming proxy resolves it next time too.
  if (!recordingUrl && meta.source !== "retell_sync" && !meta.twilio_call_sid
      && meta.twilio_recording_unavailable !== true && call.answered_at && call.started_at) {
    const found = await findTwilioRecordingForCall({
      to: call.to_e164, from: call.from_e164, startedAtMs: Date.parse(call.started_at),
    });
    if (found) {
      recordingUrl = found.url;
      await sb.from("calls").update({ recording_url: found.url, metadata: { ...meta, twilio_call_sid: found.sid } }).eq("id", id).eq("org_id", orgId);
    } else {
      await sb.from("calls").update({ metadata: { ...meta, twilio_recording_unavailable: true } }).eq("id", id).eq("org_id", orgId);
    }
  }

  const body: CallDetailResponse = {
    recording_url: recordingUrl,
    summary: call.summary,
    transcript,
    transcript_source: transcriptSource,
  };
  return NextResponse.json(body);
}
