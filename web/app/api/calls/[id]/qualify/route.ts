import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { qualifyCall } from "@/lib/analysis-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Post-hoc AI qualification of a single answered call. Reads the transcript and
// assigns one of the 9 dashboard buckets into calls.metadata.qualification.
// No-op (skipped_existing) when the call already carries a real qualification.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "deepseek_not_configured" }, { status: 503 });
  }
  try {
    const result = await qualifyCall(id);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
