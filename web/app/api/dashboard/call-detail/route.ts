import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { fetchRetellCallExtras, type TranscriptTurn } from "@/lib/retell-sync";

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

export type CallDetailTurn = { speaker: "agent" | "customer"; text: string };
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
  metadata: Record<string, unknown> | null;
};

function turnsToDetail(turns: TranscriptTurn[]): CallDetailTurn[] {
  return turns.map((t) => ({ speaker: t.role === "user" ? "customer" : "agent", text: t.content }));
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
    .select("id, org_id, recording_url, summary, metadata")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const call = data as CallRow;
  const meta = (call.metadata ?? {}) as Record<string, unknown>;

  // 1. Native Axon transcript turns.
  const { data: trData } = await sb
    .from("call_transcripts")
    .select("speaker, text, seq")
    .eq("call_id", id)
    .order("seq", { ascending: true });
  const axonTurns = (trData ?? []) as Array<{ speaker: string | null; text: string | null }>;

  let transcript: CallDetailTurn[] = [];
  let transcriptSource: "axon" | "retell" | null = null;
  let recordingUrl = call.recording_url;

  if (axonTurns.length) {
    transcript = axonTurns
      .filter((t) => t.text)
      .map((t) => ({
        speaker: t.speaker === "customer" || t.speaker === "user" ? "customer" : "agent",
        text: t.text as string,
      }));
    transcriptSource = "axon";
  } else if (meta.source === "retell_sync") {
    transcriptSource = "retell";
    const stored = Array.isArray(meta.transcript_turns) ? (meta.transcript_turns as TranscriptTurn[]) : null;
    if (stored && stored.length) {
      transcript = turnsToDetail(stored);
    }

    // Lazy backfill from Retell — ONE get-call fills whatever's still missing
    // (recording and/or transcript) so older rows become listenable/readable.
    // Skip the remote call once we've already tried for each, so re-opening a
    // row doesn't keep hammering Retell.
    const retellId = typeof meta.retell_call_id === "string" ? meta.retell_call_id : null;
    const needTranscript = transcript.length === 0 && meta.transcript_unavailable !== true
      && !(typeof meta.transcript_text === "string" && meta.transcript_text.trim());
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

  // Path A (LiveKit SIP) calls record via the Twilio TRUNK, which posts no
  // recording webhook — recording_url stays NULL even though the audio
  // exists on Twilio. The player's src already streams through
  // /api/dashboard/call-recording, whose lazy backfill #2 resolves trunk
  // recordings from metadata.twilio_call_sid; the only thing missing was
  // this response gating the player on a non-null recording_url. Surface
  // the proxy path whenever we have a Twilio SID so the player renders;
  // the proxy 404s gracefully if Twilio truly has no recording.
  if (!recordingUrl) {
    const twilioSid = typeof meta.twilio_call_sid === "string" ? meta.twilio_call_sid : "";
    if (/^CA[0-9a-f]{32}$/i.test(twilioSid) && meta.recording_unavailable !== true) {
      recordingUrl = `/api/dashboard/call-recording?id=${encodeURIComponent(id)}`;
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
