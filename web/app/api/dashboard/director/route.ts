import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Director "Vue d'ensemble" KPIs — clones the OCC demo's exec summary, fed by
// Axon's calls + usage_events (lime-window), multi-tenant. Qualification is the
// call disposition (what the agent records), so the breakdown is generic.

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

export type DirectorKpis = {
  totalCalls: number;
  answered: number;
  answeredPct: number;
  cost: number; // USD (real, from usage_events)
  rdvConfirmed: number;
  conversionRate: number;
  avgDuration: number;
  callbacks: number;
  callsOverThreshold: number;
  threshold: number;
};
export type DirectorResponse = {
  kpis: DirectorKpis;
  qualifications: { key: string; count: number }[];
};

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const orgId = await requestOrgId(request);
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date(now.getTime() - 7 * 86400_000);
  const threshold = Number(searchParams.get("threshold") ?? 60);
  const direction = searchParams.get("direction");

  const sb = supabaseServer();
  let q = sb
    .from("calls")
    .select("id, direction, state, answered_at, duration_secs, disposition")
    .eq("org_id", orgId)
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString())
    .limit(20000);
  if (direction === "inbound" || direction === "outbound") q = q.eq("direction", direction);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).filter((r) => !ACTIVE.has((r.state as string) ?? ""));
  const total = rows.length;
  const answered = rows.filter((r) => r.answered_at).length;
  const answeredDur = rows.filter((r) => r.answered_at).reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const over = rows.filter((r) => (r.duration_secs ?? 0) > threshold).length;

  const disp = new Map<string, number>();
  for (const r of rows) {
    const d = (r.disposition as string) || "—";
    disp.set(d, (disp.get(d) ?? 0) + 1);
  }
  const matches = (re: RegExp) =>
    rows.filter((r) => re.test(((r.disposition as string) || "").toLowerCase())).length;
  const rdvConfirmed = matches(/rdv|confirm|rendez/);
  const callbacks = matches(/rappel|callback|programm/);

  // Real cost over the period (USD) from usage_events.
  const { data: usage } = await sb
    .from("usage_events")
    .select("cost_cents")
    .eq("org_id", orgId)
    .gte("occurred_at", from.toISOString())
    .lte("occurred_at", to.toISOString());
  const cost = (usage ?? []).reduce((a, u) => a + (Number((u as { cost_cents: number }).cost_cents) || 0), 0) / 100;

  const body: DirectorResponse = {
    kpis: {
      totalCalls: total,
      answered,
      answeredPct: total ? (answered / total) * 100 : 0,
      cost: Math.round(cost * 100) / 100,
      rdvConfirmed,
      conversionRate: total ? (rdvConfirmed / total) * 100 : 0,
      avgDuration: answered ? Math.round(answeredDur / answered) : 0,
      callbacks,
      callsOverThreshold: over,
      threshold,
    },
    qualifications: Array.from(disp.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
  };
  return NextResponse.json(body);
}
