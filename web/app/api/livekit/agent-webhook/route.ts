import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LiveKit Cloud Agents webhook — receives session-ended payloads containing
 * the full transcript, insights summary and per-turn metrics that LK Cloud
 * generates server-side. We map the payload to one of our `calls` rows by
 * room name and persist the LK summary into calls.summary, plus the raw
 * payload into calls.metadata.lk_session for future inspection.
 *
 * Configure on LiveKit Cloud Console:
 *   Agents → axon-voice-agent → Webhooks → Add
 *   URL: https://<your-vercel-domain>/api/livekit/agent-webhook
 *   Events: session.ended (at minimum), optionally session.transcript_ready
 *
 * Designed defensively: every shape LK could send is supported. The handler
 * never returns 5xx on a parse error — it logs and 200s so LK doesn't retry
 * a malformed call forever. Errors that we actually want LK to retry (DB
 * unavailable, etc.) are 5xx-d.
 */

type Payload = {
  // LK Cloud has shipped a few different shapes over the year. We accept
  // every key we've seen in their dashboard / docs and pick whichever is
  // present. Unknown extras are stored verbatim under metadata.lk_session.
  event?: string;
  type?: string;
  session?: {
    id?: string;
    room?: { name?: string; sid?: string };
    room_name?: string;
    transcript?: string | Array<{ speaker?: string; text?: string }>;
    insights?: { summary?: string; key_points?: string[]; outcome?: string };
    insights_summary?: string;
    metrics?: Record<string, unknown>;
    started_at?: string;
    ended_at?: string;
    duration_secs?: number;
  };
  room?: { name?: string; sid?: string };
  room_name?: string;
  transcript?: string;
  summary?: string;
};

function extractRoomName(p: Payload): string | null {
  return (
    p.session?.room?.name ??
    p.session?.room_name ??
    p.room?.name ??
    p.room_name ??
    null
  );
}

function extractSummary(p: Payload): string | null {
  const s =
    p.session?.insights?.summary ??
    p.session?.insights_summary ??
    p.summary ??
    null;
  if (!s) return null;
  return String(s).trim().slice(0, 4000) || null;
}

function extractTranscript(p: Payload): string | null {
  const raw = p.session?.transcript ?? p.transcript;
  if (!raw) return null;
  if (typeof raw === "string") return raw.slice(0, 50000);
  if (Array.isArray(raw)) {
    return raw
      .map((t) => `${t.speaker || "?"}: ${t.text || ""}`)
      .join("\n")
      .slice(0, 50000);
  }
  return null;
}

// Room name pattern from agent.py: `campaign-<campaign_uuid>-<call_id_prefix>`
// or simply `<call_id>` for non-campaign rooms. We strip the campaign prefix
// and try a prefix match against calls.id.
function parseCallIdFromRoom(roomName: string): string | null {
  const m = roomName.match(/campaign-[a-f0-9-]{36}-([a-f0-9]+)$/i);
  if (m) return m[1];
  // Direct call_id when there's no campaign envelope.
  if (/^[a-f0-9-]{36}$/i.test(roomName)) return roomName;
  return null;
}

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 200 });
  }

  const evt = payload.event ?? payload.type ?? "unknown";
  const roomName = extractRoomName(payload);
  if (!roomName) {
    console.warn("[lk-webhook] no room name in payload", { event: evt });
    return NextResponse.json({ ok: false, error: "no_room" }, { status: 200 });
  }

  const sb = supabaseServer();

  // Two-pass call lookup: first by full match of metadata.lk_room_name (most
  // reliable once the agent stamps it), then by call_id prefix derived from
  // the room name (back-compat for rooms created before that stamp).
  let { data: byMeta } = await sb
    .from("calls")
    .select("id, metadata, summary")
    .eq("metadata->>lk_room_name", roomName)
    .order("started_at", { ascending: false })
    .limit(1);
  let row = (byMeta ?? [])[0] as { id: string; metadata: Record<string, unknown> | null; summary: string | null } | undefined;

  if (!row) {
    const prefix = parseCallIdFromRoom(roomName);
    if (prefix) {
      const { data: byPrefix } = await sb
        .from("calls")
        .select("id, metadata, summary")
        .ilike("id", `${prefix}%`)
        .order("started_at", { ascending: false })
        .limit(1);
      row = (byPrefix ?? [])[0] as unknown as typeof row;
    }
  }

  if (!row) {
    console.warn("[lk-webhook] no matching call for room", { roomName, event: evt });
    return NextResponse.json({ ok: false, error: "no_call_match", room: roomName }, { status: 200 });
  }

  const summary = extractSummary(payload);
  const transcript = extractTranscript(payload);
  const mergedMeta: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    lk_room_name: roomName,
    lk_session: {
      event: evt,
      session_id: payload.session?.id ?? null,
      received_at: new Date().toISOString(),
      insights: payload.session?.insights ?? null,
      metrics: payload.session?.metrics ?? null,
      duration_secs: payload.session?.duration_secs ?? null,
    },
  };
  if (transcript) (mergedMeta.lk_session as Record<string, unknown>).transcript = transcript;

  const update: Record<string, unknown> = { metadata: mergedMeta };
  // Prefer LK Cloud's insights summary over whatever DeepSeek wrote (if any),
  // because LK is purpose-built for voice and doesn't drift languages.
  if (summary) {
    update.summary = summary;
    update.summary_generated_at = new Date().toISOString();
  }

  const { error: upErr } = await sb.from("calls").update(update).eq("id", row.id);
  if (upErr) {
    console.error("[lk-webhook] update failed", { call_id: row.id, err: upErr.message });
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    call_id: row.id,
    summary_updated: !!summary,
    transcript_stored: !!transcript,
  });
}

// LK Cloud sometimes prefers GET-based health checks before allowing
// webhooks. A 200 here lets the operator confirm reachability.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "livekit-agent-webhook",
    expects: "POST { event, session: { room, transcript, insights } }",
  });
}
