import { NextResponse } from "next/server";
import { recordUsage, estimateCostCents, secondsToBillableMinutes } from "@/lib/billing";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-only endpoint: the LiveKit voice worker POSTs the REAL measured
// usage of a finished call so the dashboard's cost is computed from actual
// consumption × the rate card.
//
// Body: { org_id, call_id?, llm_tokens?, tts_chars?, stt_seconds?, call_seconds? }
//
// call_seconds is the fallback path used by the agent's finalize_call_state
// when Twilio's StatusCallback never reaches /api/twilio/status (private
// APP_URL, signature drift, etc.). The web layer looks up the call's to_e164
// to pick the right destination tariff before writing the event, so a
// UK→Maurice mobile call ends up with ~£0.22/min instead of the £0.02 UK
// default.
//
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
    call_seconds?: number;
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

  // call_seconds backup path — only writes if Twilio's StatusCallback hasn't
  // already produced a call_minutes event for this call_id. Dedupe avoids
  // double-billing when both paths fire (e.g. LK Cloud handled the call but
  // Twilio's webhook still arrives later).
  const callSecs = Number(body.call_seconds ?? 0);
  if (callSecs > 0 && body.call_id) {
    const sb = supabaseServer();
    const { data: existing } = await sb
      .from("usage_events")
      .select("id")
      .eq("event_type", "call_minutes")
      .eq("metadata->>call_id", body.call_id)
      .limit(1);
    if ((existing ?? []).length === 0) {
      // Look up the destination so the rate matches what the carrier
      // actually charges.
      const { data: callRow } = await sb
        .from("calls")
        .select("to_e164")
        .eq("id", body.call_id)
        .maybeSingle();
      const destination = (callRow as { to_e164?: string | null } | null)?.to_e164 ?? null;
      const minutes = secondsToBillableMinutes(callSecs);
      if (minutes > 0) {
        await recordUsage(
          body.org_id,
          "call_minutes",
          minutes,
          estimateCostCents("call_minutes", minutes, { destination }),
          { ...meta, source: "voice_agent_fallback", destination, call_seconds: callSecs },
        );
        recorded.push("call_minutes");
      }
    }
  }

  return NextResponse.json({ ok: true, recorded });
}
