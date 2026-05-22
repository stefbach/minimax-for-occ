import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { runAnalysisPolicies } from "@/lib/analysis-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "deepseek_not_configured" }, { status: 503 });
  }

  let body: { policy_id?: string; transcript?: string } = {};
  try {
    body = (await request.json()) as { policy_id?: string; transcript?: string };
  } catch {
    /* allow empty body */
  }

  try {
    const results = await runAnalysisPolicies(id, {
      policyId: body.policy_id,
      transcriptText: body.transcript,
    });
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
