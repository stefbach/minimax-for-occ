import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { fetchRetellTranscript, type TranscriptTurn } from "@/lib/retell-sync";

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
    // 2a. Already stored at sync time.
    const stored = Array.isArray(meta.transcript_turns) ? (meta.transcript_turns as TranscriptTurn[]) : null;
    if (stored && stored.length) {
      transcript = turnsToDetail(stored);
    } else {
      // 2b. Lazy backfill from Retell, then cache into metadata. Skip the
      // remote call once we've already tried and come up empty (e.g. an
      // unanswered call that never had a transcript), so re-opening a row
      // doesn't keep hammering Retell.
      const retellId = typeof meta.retell_call_id === "string" ? meta.retell_call_id : null;
      if (retellId && meta.transcript_unavailable !== true) {
        const fetched = await fetchRetellTranscript(retellId);
        if (fetched.turns?.length) {
          transcript = turnsToDetail(fetched.turns);
          const nextMeta = { ...meta, transcript_turns: fetched.turns, ...(fetched.text ? { transcript_text: fetched.text } : {}) };
          await sb.from("calls").update({ metadata: nextMeta }).eq("id", id).eq("org_id", orgId);
        } else if (fetched.text) {
          transcript = [{ speaker: "agent", text: fetched.text }];
          await sb.from("calls").update({ metadata: { ...meta, transcript_text: fetched.text } }).eq("id", id).eq("org_id", orgId);
        } else {
          // Nothing to show — remember so we don't refetch on every open.
          await sb.from("calls").update({ metadata: { ...meta, transcript_unavailable: true } }).eq("id", id).eq("org_id", orgId);
        }
      }
    }
    // 2c. Last resort: a flat transcript string with no turns.
    if (transcript.length === 0 && typeof meta.transcript_text === "string" && meta.transcript_text.trim()) {
      transcript = [{ speaker: "agent", text: meta.transcript_text }];
    }
  }

  const body: CallDetailResponse = {
    recording_url: call.recording_url,
    summary: call.summary,
    transcript,
    transcript_source: transcriptSource,
  };
  return NextResponse.json(body);
}
