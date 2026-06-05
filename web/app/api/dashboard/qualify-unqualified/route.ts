import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall } from "@/lib/qualification";
import { qualifyCall, type QualifyResult } from "@/lib/analysis-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

type Row = {
  id: string;
  state: string | null;
  answered_at: string | null;
  disposition: string | null;
  metadata: { qualification?: string | null } | null;
};

// Backfill: find answered calls that currently fall into the hidden "autre"
// bucket and have the AI assign a real qualification to each. Bounded per call
// so a single click can't run away on cost. GET reports the backlog count
// without spending anything; POST performs the qualification.
async function countCandidates(orgId: string, days: number): Promise<{ ids: string[] }> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await sb
    .from("calls")
    .select("id, state, answered_at, disposition, metadata")
    .eq("org_id", orgId)
    .not("answered_at", "is", null)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as Row[])
    .filter((r) => !ACTIVE.has(r.state ?? ""))
    .filter((r) => bucketForCall(r) === "autre")
    .map((r) => r.id);
  return { ids };
}

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 30)));
  try {
    const { ids } = await countCandidates(orgId, days);
    return NextResponse.json({ ok: true, pending: ids.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "deepseek_not_configured" }, { status: 503 });
  }
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days") ?? 30)));
  // Cap how many calls one request will classify (cost / time guard).
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") ?? 25)));

  try {
    const { ids } = await countCandidates(orgId, days);
    const batch = ids.slice(0, limit);
    const results: QualifyResult[] = [];
    for (const id of batch) {
      try {
        results.push(await qualifyCall(id));
      } catch (e) {
        results.push({
          call_id: id,
          status: "no_evidence",
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const qualified = results.filter((r) => r.status === "qualified").length;
    return NextResponse.json({
      ok: true,
      pending_before: ids.length,
      processed: batch.length,
      qualified,
      remaining: Math.max(0, ids.length - qualified),
      results,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
