import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import {
  dispositionBucket,
  eachDay,
  eachHour,
  isoDay,
  isoHour,
  orgFrom,
  parseRange,
} from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Granularity = "hour" | "day";
type Metric = "volume" | "aht" | "abandon_rate";

type Row = {
  started_at: string;
  duration_secs: number | null;
  state: string | null;
  disposition: string | null;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const metric = (searchParams.get("metric") ?? "volume") as Metric;
  const granularity = (searchParams.get("granularity") ?? "day") as Granularity;
  const { from, to } = parseRange(req);
  const org_id = orgFrom(req);

  // Build bucket list upfront so empty periods still render.
  const buckets =
    granularity === "hour" ? eachHour(from, to) : eachDay(from, to);

  if (!hasSupabase()) {
    return NextResponse.json(buckets.map((t) => ({ t, value: 0 })));
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("calls")
    .select("started_at, duration_secs, state, disposition")
    .eq("org_id", org_id)
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString())
    .limit(50_000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Agg = { count: number; durationSum: number; durationCount: number; abandoned: number };
  const agg = new Map<string, Agg>();
  for (const t of buckets) {
    agg.set(t, { count: 0, durationSum: 0, durationCount: 0, abandoned: 0 });
  }

  for (const c of (data ?? []) as Row[]) {
    const started = new Date(c.started_at);
    const key = granularity === "hour" ? isoHour(started) : isoDay(started);
    const e = agg.get(key);
    if (!e) continue;
    e.count += 1;
    if (typeof c.duration_secs === "number" && c.duration_secs > 0) {
      e.durationSum += c.duration_secs;
      e.durationCount += 1;
    }
    if (dispositionBucket(c.state, c.disposition) === "abandoned") {
      e.abandoned += 1;
    }
  }

  const out = buckets.map((t) => {
    const e = agg.get(t)!;
    let value = 0;
    if (metric === "volume") value = e.count;
    else if (metric === "aht")
      value = e.durationCount > 0 ? Math.round(e.durationSum / e.durationCount) : 0;
    else if (metric === "abandon_rate")
      value = e.count > 0 ? +(e.abandoned / e.count).toFixed(4) : 0;
    return { t, value };
  });

  return NextResponse.json(out);
}
