import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import {
  dispositionBucket,
  eachDay,
  isoDay,
  orgFromAsync,
  parseRange,
} from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallRow = {
  id: string;
  direction: string | null;
  state: string | null;
  started_at: string;
  ended_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  agent_handle_id: string | null;
  queue_id: string | null;
};

type Empty = {
  totals: {
    calls: number;
    answered: number;
    abandoned: number;
    transferred: number;
    voicemail: number;
    avg_duration_secs: number;
  };
  by_day: Array<{
    day: string;
    calls: number;
    answered: number;
    abandoned: number;
    transferred: number;
    voicemail: number;
  }>;
  by_hour: Array<{ hour: number; calls: number }>;
  by_agent: Array<{
    agent_handle_id: string;
    display_name: string;
    kind: string;
    calls: number;
    avg_duration_secs: number;
  }>;
  by_queue: Array<{
    queue_id: string;
    name: string;
    calls: number;
    avg_wait_secs: number;
  }>;
  by_campaign: Array<{
    campaign_id: string;
    name: string;
    targets_total: number;
    done: number;
    failed: number;
    success_rate: number;
  }>;
  by_disposition: Array<{ disposition: string; count: number }>;
  range: { from: string; to: string };
};

function emptyPayload(from: Date, to: Date): Empty {
  return {
    totals: {
      calls: 0,
      answered: 0,
      abandoned: 0,
      transferred: 0,
      voicemail: 0,
      avg_duration_secs: 0,
    },
    by_day: eachDay(from, to).map((day) => ({
      day,
      calls: 0,
      answered: 0,
      abandoned: 0,
      transferred: 0,
      voicemail: 0,
    })),
    by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0 })),
    by_agent: [],
    by_queue: [],
    by_campaign: [],
    by_disposition: [],
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

export async function GET(req: Request) {
  const { from, to } = parseRange(req);
  const org_id = await orgFromAsync(req);

  if (!hasSupabase()) {
    return NextResponse.json(emptyPayload(from, to));
  }

  const sb = supabaseServer();

  // Pull every call in the window. We use a generous cap; for huge
  // tenants you'd page or push aggregation into SQL.
  const { data: callsData, error: callsErr } = await sb
    .from("calls")
    .select(
      "id, direction, state, started_at, ended_at, answered_at, duration_secs, disposition, agent_handle_id, queue_id",
    )
    .eq("org_id", org_id)
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString())
    .order("started_at", { ascending: true })
    .limit(50_000);

  if (callsErr) {
    return NextResponse.json({ error: callsErr.message }, { status: 500 });
  }

  const calls: CallRow[] = (callsData ?? []) as CallRow[];

  // ── Totals + per-day + per-hour ─────────────────────────────────────────
  const dayMap = new Map<
    string,
    { calls: number; answered: number; abandoned: number; transferred: number; voicemail: number }
  >();
  for (const d of eachDay(from, to)) {
    dayMap.set(d, { calls: 0, answered: 0, abandoned: 0, transferred: 0, voicemail: 0 });
  }
  const hourMap = new Map<number, number>();
  for (let h = 0; h < 24; h += 1) hourMap.set(h, 0);

  let totalCalls = 0;
  let answered = 0;
  let abandoned = 0;
  let transferred = 0;
  let voicemail = 0;
  let durationSum = 0;
  let durationCount = 0;

  const dispositionMap = new Map<string, number>();

  // Per-agent aggregation
  const agentAgg = new Map<
    string,
    { calls: number; durationSum: number; durationCount: number }
  >();
  // Per-queue aggregation (avg wait = answered_at − started_at, fallback 0)
  const queueAgg = new Map<
    string,
    { calls: number; waitSum: number; waitCount: number }
  >();

  for (const c of calls) {
    totalCalls += 1;
    const bucket = dispositionBucket(c.state, c.disposition);
    if (bucket === "answered") answered += 1;
    else if (bucket === "abandoned") abandoned += 1;
    else if (bucket === "transferred") transferred += 1;
    else if (bucket === "voicemail") voicemail += 1;

    const dispKey = c.disposition && c.disposition.trim() ? c.disposition : "(non renseigné)";
    dispositionMap.set(dispKey, (dispositionMap.get(dispKey) ?? 0) + 1);

    const started = new Date(c.started_at);
    const dayKey = isoDay(started);
    const dayEntry = dayMap.get(dayKey);
    if (dayEntry) {
      dayEntry.calls += 1;
      if (bucket === "answered") dayEntry.answered += 1;
      else if (bucket === "abandoned") dayEntry.abandoned += 1;
      else if (bucket === "transferred") dayEntry.transferred += 1;
      else if (bucket === "voicemail") dayEntry.voicemail += 1;
    }

    const hourKey = started.getUTCHours();
    hourMap.set(hourKey, (hourMap.get(hourKey) ?? 0) + 1);

    if (typeof c.duration_secs === "number" && c.duration_secs > 0) {
      durationSum += c.duration_secs;
      durationCount += 1;
    }

    if (c.agent_handle_id) {
      const a = agentAgg.get(c.agent_handle_id) ?? {
        calls: 0,
        durationSum: 0,
        durationCount: 0,
      };
      a.calls += 1;
      if (typeof c.duration_secs === "number" && c.duration_secs > 0) {
        a.durationSum += c.duration_secs;
        a.durationCount += 1;
      }
      agentAgg.set(c.agent_handle_id, a);
    }

    if (c.queue_id) {
      const q = queueAgg.get(c.queue_id) ?? { calls: 0, waitSum: 0, waitCount: 0 };
      q.calls += 1;
      if (c.answered_at) {
        const wait = (new Date(c.answered_at).getTime() - started.getTime()) / 1000;
        if (wait >= 0 && wait < 3600) {
          q.waitSum += wait;
          q.waitCount += 1;
        }
      }
      queueAgg.set(c.queue_id, q);
    }
  }

  // ── Resolve agent and queue names ──────────────────────────────────────
  const agentIds = Array.from(agentAgg.keys());
  const queueIds = Array.from(queueAgg.keys());

  const [agentsRes, queuesRes, campaignsRes, targetsRes] = await Promise.all([
    agentIds.length
      ? sb
          .from("agent_handles")
          .select("id, display_name, kind")
          .in("id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    queueIds.length
      ? sb.from("queues").select("id, name").in("id", queueIds)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("campaigns")
      .select("id, name, state")
      .eq("org_id", org_id)
      .limit(200),
    sb
      .from("campaign_targets")
      .select("campaign_id, status"),
  ]);

  const agentMeta = new Map<string, { display_name: string; kind: string }>();
  for (const a of (agentsRes.data ?? []) as Array<{
    id: string;
    display_name: string;
    kind: string;
  }>) {
    agentMeta.set(a.id, { display_name: a.display_name, kind: a.kind });
  }

  const queueMeta = new Map<string, { name: string }>();
  for (const q of (queuesRes.data ?? []) as Array<{ id: string; name: string }>) {
    queueMeta.set(q.id, { name: q.name });
  }

  // ── Per-campaign aggregation ───────────────────────────────────────────
  const campaigns = (campaignsRes.data ?? []) as Array<{
    id: string;
    name: string;
    state: string;
  }>;
  const targetRows = (targetsRes.data ?? []) as Array<{
    campaign_id: string;
    status: string;
  }>;
  const targetAgg = new Map<
    string,
    { total: number; done: number; failed: number }
  >();
  for (const t of targetRows) {
    const e = targetAgg.get(t.campaign_id) ?? { total: 0, done: 0, failed: 0 };
    e.total += 1;
    if (t.status === "done" || t.status === "answered") e.done += 1;
    else if (t.status === "failed" || t.status === "no_answer" || t.status === "busy")
      e.failed += 1;
    targetAgg.set(t.campaign_id, e);
  }

  const by_campaign = campaigns
    .filter((c) => targetAgg.has(c.id))
    .map((c) => {
      const t = targetAgg.get(c.id) ?? { total: 0, done: 0, failed: 0 };
      const success_rate = t.total > 0 ? t.done / t.total : 0;
      return {
        campaign_id: c.id,
        name: c.name,
        targets_total: t.total,
        done: t.done,
        failed: t.failed,
        success_rate,
      };
    })
    .sort((a, b) => b.targets_total - a.targets_total);

  const by_agent = Array.from(agentAgg.entries())
    .map(([agent_handle_id, agg]) => {
      const meta = agentMeta.get(agent_handle_id);
      return {
        agent_handle_id,
        display_name: meta?.display_name ?? "(inconnu)",
        kind: meta?.kind ?? "ai",
        calls: agg.calls,
        avg_duration_secs:
          agg.durationCount > 0 ? Math.round(agg.durationSum / agg.durationCount) : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const by_queue = Array.from(queueAgg.entries())
    .map(([queue_id, agg]) => {
      const meta = queueMeta.get(queue_id);
      return {
        queue_id,
        name: meta?.name ?? "(file inconnue)",
        calls: agg.calls,
        avg_wait_secs:
          agg.waitCount > 0 ? Math.round(agg.waitSum / agg.waitCount) : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const by_day = Array.from(dayMap.entries()).map(([day, v]) => ({ day, ...v }));
  const by_hour = Array.from(hourMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hour, calls]) => ({ hour, calls }));
  const by_disposition = Array.from(dispositionMap.entries())
    .map(([disposition, count]) => ({ disposition, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    totals: {
      calls: totalCalls,
      answered,
      abandoned,
      transferred,
      voicemail,
      avg_duration_secs:
        durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    },
    by_day,
    by_hour,
    by_agent,
    by_queue,
    by_campaign,
    by_disposition,
    range: { from: from.toISOString(), to: to.toISOString() },
  });
}
