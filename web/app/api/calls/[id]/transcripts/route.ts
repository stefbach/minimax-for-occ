import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TurnInput {
  seq?: number;
  speaker?: string;
  speaker_id?: string | null;
  text?: string;
  started_at?: string;
  ended_at?: string | null;
  confidence?: number | null;
  language?: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const orgId = await requestOrgId(request);
  const admin = supabaseServer();
  // Verify the parent call belongs to the caller's org before returning
  // transcript turns (which inherit the tenant via call_id).
  const { data: parentCall } = await admin
    .from("calls")
    .select("id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!parentCall) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data, error } = await admin
    .from("call_transcripts")
    .select("id, seq, speaker, speaker_id, text, started_at, ended_at, confidence, language")
    .eq("call_id", id)
    .order("seq", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  let body: TurnInput | TurnInput[] = {};
  try {
    body = (await request.json()) as TurnInput | TurnInput[];
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const turns = Array.isArray(body) ? body : [body];
  if (turns.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  // Caller may be the AI worker (service key) or a logged-in human — both fine.
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user?.id ?? null;

  const orgId = await requestOrgId(request);
  const admin = supabaseServer();
  const { data: call, error: callErr } = await admin
    .from("calls")
    .select("id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Figure out next seq if turns don't carry one.
  const { data: last } = await admin
    .from("call_transcripts")
    .select("seq")
    .eq("call_id", id)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSeq = ((last?.seq as number | undefined) ?? -1) + 1;

  const rows = turns
    .map((t) => {
      const speaker = (t.speaker ?? "").trim();
      const text = (t.text ?? "").trim();
      if (!speaker || !text) return null;
      const seq = typeof t.seq === "number" ? t.seq : nextSeq++;
      return {
        call_id: id,
        seq,
        speaker,
        speaker_id: t.speaker_id ?? (speaker === "agent_human" ? userId : null),
        text,
        started_at: t.started_at ?? new Date().toISOString(),
        ended_at: t.ended_at ?? null,
        confidence: t.confidence ?? null,
        language: t.language ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: "no_valid_turns" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("call_transcripts")
    .insert(rows)
    .select("id, seq, speaker, speaker_id, text, started_at, ended_at, confidence, language");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? [], { status: 201 });
}
