import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { generateCallSummary } from "@/lib/analysis-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "openai_not_configured" }, { status: 503 });
  }
  try {
    const summary = await generateCallSummary(id);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
