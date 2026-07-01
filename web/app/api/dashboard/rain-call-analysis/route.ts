import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";
import { ensureCallAnalysis, RainAnalysisError } from "@/lib/rain-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  await requestOrgId(req);
  const sb = supabaseServer();

  const body = (await req.json().catch(() => ({}))) as { call_id?: string };
  const callId = body.call_id;
  if (!callId) return NextResponse.json({ error: "call_id required" }, { status: 400 });

  const { data: call, error } = await sb
    .from("calls")
    .select("id, recording_url, metadata")
    .eq("id", callId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });

  const wasCached = Boolean((call.metadata as Record<string, unknown> | null)?.rain_ai_review);

  try {
    const aiReview = await ensureCallAnalysis(sb, call);
    return NextResponse.json({ ok: true, ai_review: aiReview, cached: wasCached });
  } catch (e) {
    if (e instanceof RainAnalysisError) {
      const status = e.code === "no_recording" ? 404 : e.code === "empty_transcript" ? 422 : 502;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "unknown", message: msg }, { status: 500 });
  }
}
