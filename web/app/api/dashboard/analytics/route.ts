import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generic call analytics over an arbitrary period, computed from the org's
// `calls` table (multi-tenant safe). No OCC-specific logic. Aggregations are
// done in Node over the fetched rows (capped) — fine at current scale; can be
// pushed into SQL RPCs later if volumes grow.

const ACTIVE_STATES = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);
// Rough blended per-minute cost estimate (LiveKit + Twilio + LLM/TTS). Used for
// the "Coût estimé" tile only; clearly labelled as an estimate in the UI.
const COST_PER_MIN = Number(process.env.CALL_COST_PER_MIN ?? 0.12);
const ROW_CAP = 8000;

export type AnalyticsKpis = {
  total: number;
  answered: number;
  answer_rate: number;
  avg_duration_secs: number;
  abandon_rate: number;
  inbound: number;
  outbound: number;
  cost_estimate: number;
  cost_per_min: number;
};

export type Bucket = { key: string; count: number };
export type AgentPerf = {
  agent: string;
  total: number;
  answered: number;
  answer_rate: number;
  avg_duration_secs: number;
};
export type HeatCell = { weekday: number; hour: number; count: number };
export type AnalyticsResponse = {
  from: string;
  to: string;
  granularity: "hour" | "day";
  kpis: AnalyticsKpis;
  volume: Bucket[];
  dispositions: Bucket[];
  agents: AgentPerf[];
  heatmap: HeatCell[];
  duration_histogram: Bucket[];
  attempt_funnel: { attempt: number; total: number; answered: number }[];
  truncated: boolean;
};

type CallRow = {
  id: string;
  direction: string | null;
  state: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  contact_id: string | null;
  agent_handles: { display_name: string | null } | null;
};

function isAnswered(r: CallRow): boolean {
  // Answered = the callee picked up. answered_at is the strongest signal;
  // fall back to a non-failed ended call with a duration.
  if (r.answered_at) return true;
  return r.state === "ended" && (r.duration_secs ?? 0) > 0;
}

const DURATION_BUCKETS: { key: string; max: number }[] = [
  { key: "0–10s", max: 10 },
  { key: "10–30s", max: 30 },
  { key: "30–60s", max: 60 },
  { key: "1–3min", max: 180 },
  { key: "3–5min", max: 300 },
  { key: "5min+", max: Infinity },
];

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const { searchParams } = new URL(request.url);

  const now = new Date();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const to = toParam ? new Date(toParam) : now;
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 7 * 86400_000);
  const direction = searchParams.get("direction"); // inbound | outbound | null
  const minDuration = Number(searchParams.get("min_duration") ?? 0);

  const rangeMs = to.getTime() - from.getTime();
  const granularity: "hour" | "day" = rangeMs <= 2 * 86400_000 ? "hour" : "day";

  const sb = supabaseServer();
  let q = sb
    .from("calls")
    .select(
      "id, direction, state, started_at, answered_at, duration_secs, disposition, contact_id, agent_handles(display_name)",
    )
    .eq("org_id", orgId)
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString())
    .order("started_at", { ascending: true })
    .limit(ROW_CAP + 1);
  if (direction === "inbound" || direction === "outbound") q = q.eq("direction", direction);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Supabase types the joined relation as an array; flatten to a single object.
  let rows: CallRow[] = (data ?? []).map((r: any) => ({
    ...r,
    agent_handles: Array.isArray(r.agent_handles) ? r.agent_handles[0] ?? null : r.agent_handles ?? null,
  }));
  const truncated = rows.length > ROW_CAP;
  if (truncated) rows = rows.slice(0, ROW_CAP);
  // Exclude still-active calls from historical aggregates; honour min duration.
  rows = rows.filter((r) => !ACTIVE_STATES.has(r.state ?? "") && (r.duration_secs ?? 0) >= minDuration);

  // ── KPIs ──
  const total = rows.length;
  const answered = rows.filter(isAnswered).length;
  const durSum = rows.reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const answeredDurSum = rows.filter(isAnswered).reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const inbound = rows.filter((r) => r.direction === "inbound").length;
  const outbound = rows.filter((r) => r.direction === "outbound").length;
  const kpis: AnalyticsKpis = {
    total,
    answered,
    answer_rate: total ? answered / total : 0,
    avg_duration_secs: answered ? Math.round(answeredDurSum / answered) : 0,
    abandon_rate: total ? (total - answered) / total : 0,
    inbound,
    outbound,
    cost_estimate: Math.round((durSum / 60) * COST_PER_MIN * 100) / 100,
    cost_per_min: COST_PER_MIN,
  };

  // ── Volume buckets ──
  const volMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.started_at) continue;
    const d = new Date(r.started_at);
    const key =
      granularity === "hour"
        ? `${d.toISOString().slice(0, 13)}:00`
        : d.toISOString().slice(0, 10);
    volMap.set(key, (volMap.get(key) ?? 0) + 1);
  }
  const volume: Bucket[] = Array.from(volMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));

  // ── Dispositions ──
  const dispMap = new Map<string, number>();
  for (const r of rows) {
    const k = r.disposition || r.state || "—";
    dispMap.set(k, (dispMap.get(k) ?? 0) + 1);
  }
  const dispositions: Bucket[] = Array.from(dispMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  // ── Agent performance ──
  const agentMap = new Map<string, { total: number; answered: number; dur: number }>();
  for (const r of rows) {
    const name = r.agent_handles?.display_name || "—";
    const a = agentMap.get(name) ?? { total: 0, answered: 0, dur: 0 };
    a.total += 1;
    if (isAnswered(r)) {
      a.answered += 1;
      a.dur += r.duration_secs ?? 0;
    }
    agentMap.set(name, a);
  }
  const agents: AgentPerf[] = Array.from(agentMap.entries())
    .map(([agent, a]) => ({
      agent,
      total: a.total,
      answered: a.answered,
      answer_rate: a.total ? a.answered / a.total : 0,
      avg_duration_secs: a.answered ? Math.round(a.dur / a.answered) : 0,
    }))
    .sort((x, y) => y.total - x.total);

  // ── Heatmap (weekday 0-6 × hour 0-23), local time ──
  const heatMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.started_at) continue;
    const d = new Date(r.started_at);
    const key = `${d.getDay()}_${d.getHours()}`;
    heatMap.set(key, (heatMap.get(key) ?? 0) + 1);
  }
  const heatmap: HeatCell[] = Array.from(heatMap.entries()).map(([k, count]) => {
    const [weekday, hour] = k.split("_").map(Number);
    return { weekday, hour, count };
  });

  // ── Duration histogram ──
  const histCounts = new Array(DURATION_BUCKETS.length).fill(0);
  for (const r of rows) {
    const s = r.duration_secs ?? 0;
    const idx = DURATION_BUCKETS.findIndex((b) => s <= b.max);
    histCounts[idx >= 0 ? idx : DURATION_BUCKETS.length - 1] += 1;
  }
  const duration_histogram: Bucket[] = DURATION_BUCKETS.map((b, i) => ({
    key: b.key,
    count: histCounts[i],
  }));

  // ── Attempt funnel: nth call to a given contact within the period ──
  const byContact = new Map<string, CallRow[]>();
  for (const r of rows) {
    if (!r.contact_id) continue;
    (byContact.get(r.contact_id) ?? byContact.set(r.contact_id, []).get(r.contact_id)!).push(r);
  }
  const attemptAgg = new Map<number, { total: number; answered: number }>();
  for (const calls of byContact.values()) {
    calls.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
    calls.forEach((r, i) => {
      const attempt = Math.min(i + 1, 5); // cap at "5+"
      const agg = attemptAgg.get(attempt) ?? { total: 0, answered: 0 };
      agg.total += 1;
      if (isAnswered(r)) agg.answered += 1;
      attemptAgg.set(attempt, agg);
    });
  }
  const attempt_funnel = Array.from(attemptAgg.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([attempt, v]) => ({ attempt, total: v.total, answered: v.answered }));

  const body: AnalyticsResponse = {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    kpis,
    volume,
    dispositions,
    agents,
    heatmap,
    duration_histogram,
    attempt_funnel,
    truncated,
  };
  return NextResponse.json(body);
}
