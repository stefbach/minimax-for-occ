import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { type LeadsSource } from "@/lib/leads-source";
import { parseCallSystem } from "@/lib/call-system";
import { loadInsightsCalls } from "@/lib/insights/load-calls";
import { generateInsights } from "@/lib/insights/generate";
import type { InsightsResponse, InsightsResult } from "@/lib/insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel cap — a full period can take 60-120s

interface Body {
  from?: string;
  to?: string;
  direction?: string;
  leads_source?: string;
  system?: string;
  period_label?: string;
  force_refresh?: boolean;
}

// Stable signature of the request so the same period+filters+call-set reuses
// the cached report; a new sync (different ids) yields a new key.
function makeCacheKey(parts: {
  periodLabel: string;
  direction: string;
  leadsSource: string;
  system: string;
  ids: string[];
}): string {
  const sorted = [...parts.ids].sort().join("|");
  let hash = 0;
  const str = `${parts.periodLabel}::${parts.direction}::${parts.leadsSource}::${parts.system}::${sorted}`;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return `${parts.leadsSource}-${parts.system}-${parts.direction}-${parts.ids.length}-${hash.toString(36)}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const now = new Date();
  const to = body.to ? new Date(body.to) : now;
  const from = body.from ? new Date(body.from) : new Date(now.getTime() - 7 * 86400_000);
  const direction = body.direction && body.direction !== "all" ? body.direction : null;
  const leadsSource: LeadsSource = body.leads_source === "test" ? "test" : "prod";
  const system = parseCallSystem(body.system);
  const periodLabel = body.period_label?.trim() || "Période";

  const { inputs, index } = await loadInsightsCalls({ orgId, from, to, direction, leadsSource, system });
  if (inputs.length === 0) {
    return NextResponse.json({ error: "Aucun appel à analyser pour cette sélection." }, { status: 400 });
  }

  const sb = supabaseServer();
  const cacheKey = makeCacheKey({
    periodLabel,
    direction: direction ?? "all",
    leadsSource,
    system,
    ids: inputs.map((c) => c.call_id),
  });

  // Shared cache: reuse unless the user asked to regenerate.
  if (!body.force_refresh) {
    const { data: cached } = await sb
      .from("dashboard_insights")
      .select("payload")
      .eq("org_id", orgId)
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached) {
      const insights = (cached as { payload: InsightsResult }).payload;
      const resp: InsightsResponse = {
        insights: { ...insights, meta: { ...insights.meta, cached: true } },
        calls_index: index,
      };
      return NextResponse.json(resp);
    }
  }

  let insights: InsightsResult;
  try {
    insights = await generateInsights({ calls: inputs, periodLabel });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation_failed" }, { status: 500 });
  }

  // Upsert the shared report (one per org+signature).
  await sb
    .from("dashboard_insights")
    .upsert(
      { org_id: orgId, cache_key: cacheKey, period_label: periodLabel, payload: insights, generated_at: new Date().toISOString() },
      { onConflict: "org_id,cache_key" },
    );

  const resp: InsightsResponse = { insights, calls_index: index };
  return NextResponse.json(resp);
}
