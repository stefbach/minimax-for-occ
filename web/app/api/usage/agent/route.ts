import { NextResponse } from "next/server";
import { recordUsage, estimateCostCents } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-only endpoint: the LiveKit voice worker POSTs the REAL measured usage
// of a finished call (LLM tokens, TTS characters, STT seconds) so the
// dashboard's cost is computed from actual consumption × the rate card.
//
// Body: { org_id, call_id?, llm_tokens?, tts_chars?, stt_seconds? }
// Optional bearer APP_SHARED_TOKEN (matches the worker's other calls).
export async function POST(req: Request) {
  const expected = process.env.APP_SHARED_TOKEN;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth && auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => null)) as {
    org_id?: string;
    call_id?: string;
    llm_tokens?: number;
    tts_chars?: number;
    stt_seconds?: number;
  } | null;
  if (!body?.org_id) {
    return NextResponse.json({ error: "org_id requis" }, { status: 400 });
  }

  const meta = { source: "voice_agent", call_id: body.call_id ?? null };
  const recorded: string[] = [];

  const llm = Number(body.llm_tokens ?? 0);
  if (llm > 0) {
    await recordUsage(body.org_id, "llm_tokens", llm, estimateCostCents("llm_tokens", llm), meta);
    recorded.push("llm_tokens");
  }
  const tts = Number(body.tts_chars ?? 0);
  if (tts > 0) {
    await recordUsage(body.org_id, "tts_chars", tts, estimateCostCents("tts_chars", tts), meta);
    recorded.push("tts_chars");
  }
  const sttSecs = Number(body.stt_seconds ?? 0);
  if (sttSecs > 0) {
    // STT is billed per minute; keep the real seconds in metadata for audit.
    const minutes = sttSecs / 60;
    await recordUsage(body.org_id, "stt_minutes", minutes, estimateCostCents("stt_minutes", minutes), {
      ...meta,
      stt_seconds: sttSecs,
    });
    recorded.push("stt_minutes");
  }

  return NextResponse.json({ ok: true, recorded });
}
