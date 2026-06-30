import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall } from "@/lib/qualification";
import { qualifyCall, type QualifyResult } from "@/lib/analysis-runner";
import { callInLeadsScope, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem, type CallSystem } from "@/lib/call-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

type Row = {
  id: string;
  state: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  to_e164: string | null;
  metadata: { qualification?: string | null; qualification_source?: string | null; agent_stage?: number | null; analysis_skipped?: string | null; source?: string } | null;
};

// Must stay in sync with qualifyCall() in analysis-runner.ts.
const TRUSTED_QUAL_SOURCES = new Set(["twilio_amd", "manual_softphone", "human"]);

// Mirror analysis-runner's AGENT_STAGE_MIN_SECS: only long-enough calls are
// candidates for agent-stage detection (a transfer never happens in seconds).
const AGENT_STAGE_MIN_SECS = 60;

// Backfill: find answered calls that currently fall into the hidden "autre"
// bucket and have the AI assign a real qualification to each. Bounded per call
// so a single click can't run away on cost. GET reports the backlog count
// without spending anything; POST performs the qualification.
// Scoped to the selected leads source so the Test toggle doesn't accidentally
// requalify production calls (and vice-versa).
async function countCandidates(
  orgId: string,
  days: number,
  source: LeadsSource,
  system: CallSystem,
): Promise<{ ids: string[] }> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { rows: data, error } = await fetchAllPaged<Row>(
    () =>
      sb
        .from("calls")
        .select("id, state, answered_at, duration_secs, disposition, to_e164, metadata")
        .eq("org_id", orgId)
        .not("answered_at", "is", null)
        .gte("started_at", since)
        .order("started_at", { ascending: false }) as unknown as Rangeable<Row>,
    { maxRows: 20000 },
  );
  if (error) throw new Error(error);
  const scope = await leadsScopeFor(source);
  // A call needs the AI pass if it's still unqualified ("autre") OR if it's a
  // long-enough call whose agent-chain stage hasn't been detected yet. One pass
  // handles both, so either reason makes it a candidate.
  const ids = data
    .filter((r) => !ACTIVE.has(r.state ?? ""))
    .filter((r) => callInLeadsScope(r.to_e164, scope))
    .filter((r) => callMatchesSystem(r.metadata?.source, system))
    .filter((r) => {
      if (r.metadata?.analysis_skipped) return false;
      const qSrc = r.metadata?.qualification_source ?? "";
      const isExplicitQual = !!r.metadata?.qualification && TRUSTED_QUAL_SOURCES.has(qSrc);
      const isAiAutoQual = qSrc === "ai_auto" && bucketForCall(r) !== "autre";
      // Re-qualify if no trusted source has classified it yet (includes in-call
      // agent labels written without a qualification_source, e.g. wrong "rdv_confirme").
      const needsQual = !isExplicitQual && !isAiAutoQual;
      const needsStage = r.metadata?.agent_stage == null && (r.duration_secs ?? 0) >= AGENT_STAGE_MIN_SECS;
      return needsQual || needsStage;
    })
    .map((r) => r.id);
  return { ids };
}

function parseLeadsSource(qs: URLSearchParams): LeadsSource {
  return qs.get("leads_source") === "test" ? "test" : "prod";
}

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const sp = new URL(request.url).searchParams;
  const days = Math.min(365, Math.max(1, Number(sp.get("days") ?? 30)));
  const source = parseLeadsSource(sp);
  const system = parseCallSystem(sp.get("system"));
  try {
    const { ids } = await countCandidates(orgId, days, source, system);
    return NextResponse.json({ ok: true, pending: ids.length, leads_source: source });
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
  // Cap how many calls one request will classify (cost / time guard). One pass
  // now also detects the agent-chain stage, and the client drains in a loop, so
  // keep batches comfortably under maxDuration.
  const limit = Math.min(40, Math.max(1, Number(searchParams.get("limit") ?? 20)));
  const source = parseLeadsSource(searchParams);
  const system = parseCallSystem(searchParams.get("system"));

  try {
    const { ids } = await countCandidates(orgId, days, source, system);
    const batch = ids.slice(0, limit);
    // Process with light concurrency so a batch finishes in a few seconds
    // instead of (limit × ~3s) sequentially — keeps the background drain quick.
    const CONCURRENCY = 5;
    const results: QualifyResult[] = [];
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(slice.map((id) => qualifyCall(id, { markNoEvidence: true })));
      settled.forEach((s, j) => {
        results.push(
          s.status === "fulfilled"
            ? s.value
            : { call_id: slice[j], status: "no_evidence", reason: s.reason instanceof Error ? s.reason.message : String(s.reason) },
        );
      });
    }
    const qualified = results.filter((r) => r.status === "qualified").length;
    return NextResponse.json({
      ok: true,
      leads_source: source,
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
