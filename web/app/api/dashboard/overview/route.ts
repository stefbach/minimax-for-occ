import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

export type DashboardKpis = {
  calls_count: number;
  avg_duration_secs: number;
  abandon_rate: number;
  ai_pct: number;
  human_pct: number;
  active_campaigns: number;
  contacts_to_recall: number;
};

export type DispositionBucket = {
  disposition: string;
  count: number;
};

export type VolumeBucket = {
  hour: string; // ISO hour bucket
  count: number;
};

export type CampaignRow = {
  id: string;
  name: string;
  state: string;
  targets_total: number;
  targets_done: number;
  pct_done: number;
  last_activity: string | null;
};

export type DashboardOverviewResponse = {
  today: DashboardKpis;
  yesterday: DashboardKpis;
  volume_24h: VolumeBucket[];
  dispositions: DispositionBucket[];
  campaigns: CampaignRow[];
};

function startOfTodayUTC(d = new Date()): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

async function kpisForWindow(
  orgId: string,
  from: Date,
  to: Date,
): Promise<DashboardKpis> {
  const sb = supabaseServer();

  // Calls in window
  const { data: calls } = await sb
    .from("calls")
    .select("id, started_at, ended_at, duration_secs, disposition, agent_handle_id")
    .eq("org_id", orgId)
    .gte("started_at", from.toISOString())
    .lt("started_at", to.toISOString());

  const rows = calls ?? [];
  const callsCount = rows.length;

  const endedRows = rows.filter((r) => r.ended_at && typeof r.duration_secs === "number");
  const avgDuration = endedRows.length
    ? Math.round(
        endedRows.reduce((s, r) => s + (r.duration_secs ?? 0), 0) / endedRows.length,
      )
    : 0;

  const abandoned = rows.filter((r) => r.disposition === "abandoned").length;
  const abandonRate = callsCount > 0 ? abandoned / callsCount : 0;

  // AI / human mix — fetch agent_handles for handles referenced
  const handleIds = Array.from(
    new Set(rows.map((r) => r.agent_handle_id).filter(Boolean)),
  ) as string[];
  let aiCount = 0;
  let humanCount = 0;
  if (handleIds.length > 0) {
    const { data: handles } = await sb
      .from("agent_handles")
      .select("id, kind")
      .in("id", handleIds);
    const kindById = new Map<string, string>();
    for (const h of handles ?? []) kindById.set(h.id as string, h.kind as string);
    for (const r of rows) {
      const k = r.agent_handle_id ? kindById.get(r.agent_handle_id) : undefined;
      if (k === "ai") aiCount++;
      else if (k === "human") humanCount++;
    }
  }
  const handledTotal = aiCount + humanCount;
  const aiPct = handledTotal > 0 ? aiCount / handledTotal : 0;
  const humanPct = handledTotal > 0 ? humanCount / handledTotal : 0;

  // Active campaigns (state=running) — not windowed, but snapshot
  const { count: activeCampaigns } = await sb
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("state", "running");

  // Contacts to recall (next_attempt_at <= now, in pending state) — snapshot
  const nowIso = new Date().toISOString();
  const { count: toRecall } = await sb
    .from("campaign_targets")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso);

  return {
    calls_count: callsCount,
    avg_duration_secs: avgDuration,
    abandon_rate: abandonRate,
    ai_pct: aiPct,
    human_pct: humanPct,
    active_campaigns: activeCampaigns ?? 0,
    contacts_to_recall: toRecall ?? 0,
  };
}

async function volume24h(orgId: string): Promise<VolumeBucket[]> {
  const sb = supabaseServer();
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const { data } = await sb
    .from("calls")
    .select("started_at")
    .eq("org_id", orgId)
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString());

  const buckets = new Map<string, number>();
  // Pre-fill 24 hourly buckets
  for (let i = 23; i >= 0; i--) {
    const t = new Date(end.getTime() - i * 60 * 60 * 1000);
    t.setUTCMinutes(0, 0, 0);
    buckets.set(t.toISOString(), 0);
  }
  for (const row of data ?? []) {
    const t = new Date(row.started_at as string);
    t.setUTCMinutes(0, 0, 0);
    const k = t.toISOString();
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([hour, count]) => ({ hour, count }));
}

async function dispositionsToday(orgId: string): Promise<DispositionBucket[]> {
  const sb = supabaseServer();
  const from = startOfTodayUTC();
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const { data } = await sb
    .from("calls")
    .select("disposition")
    .eq("org_id", orgId)
    .gte("started_at", from.toISOString())
    .lt("started_at", to.toISOString());

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const k = (r.disposition as string | null) || "unknown";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([disposition, count]) => ({ disposition, count }))
    .sort((a, b) => b.count - a.count);
}

async function recentCampaigns(orgId: string): Promise<CampaignRow[]> {
  const sb = supabaseServer();
  const { data: camps } = await sb
    .from("campaigns")
    .select("id, name, state, updated_at, created_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(8);

  const out: CampaignRow[] = [];
  for (const c of camps ?? []) {
    const { count: total } = await sb
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id as string);
    const { count: done } = await sb
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id as string)
      .in("status", ["done", "answered"]);
    const t = total ?? 0;
    const d = done ?? 0;
    out.push({
      id: c.id as string,
      name: c.name as string,
      state: c.state as string,
      targets_total: t,
      targets_done: d,
      pct_done: t > 0 ? d / t : 0,
      last_activity: (c.updated_at as string | null) ?? (c.created_at as string | null),
    });
  }
  return out;
}

export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org_id") || DEFAULT_ORG;

  try {
    const todayStart = startOfTodayUTC();
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    const [today, yesterday, volume, dispositions, campaigns] = await Promise.all([
      kpisForWindow(orgId, todayStart, todayEnd),
      kpisForWindow(orgId, yesterdayStart, todayStart),
      volume24h(orgId),
      dispositionsToday(orgId),
      recentCampaigns(orgId),
    ]);

    const payload: DashboardOverviewResponse = {
      today,
      yesterday,
      volume_24h: volume,
      dispositions,
      campaigns,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
