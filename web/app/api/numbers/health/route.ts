import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/numbers/health?status=&country=
 *
 * Returns rows from the `phone_numbers_health` view enriched with 30-day
 * call volume and a `health_status` bucket (`active`, `low_volume`,
 * `dormant`, `never_used`). The view inherits RLS from phone_numbers so
 * tenancy is preserved.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ rows: [], summary: emptySummary() });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // active|low_volume|dormant|never_used
  const country = url.searchParams.get("country"); // FR, US, ...
  const orgId = await requestOrgId(req);

  const sb = supabaseServer();
  let query = sb
    .from("phone_numbers_health")
    .select("*")
    .eq("org_id", orgId)
    .order("calls_30d", { ascending: false })
    .limit(1000);

  if (status) query = query.eq("health_status", status);
  if (country) query = query.eq("country_code", country.toUpperCase());

  const { data, error } = await query;
  if (error) {
    // View may not exist yet (migration not applied) — degrade gracefully.
    return NextResponse.json(
      { rows: [], summary: emptySummary(), warning: error.message },
      { status: 200 },
    );
  }

  const rows = data ?? [];
  const summary = summarise(rows);
  return NextResponse.json({ rows, summary });
}

interface HealthRow {
  health_status?: string;
  calls_30d?: number;
  answered_30d?: number;
  webhook_configured?: boolean;
}

function summarise(rows: HealthRow[]) {
  const out = {
    total: rows.length,
    active: 0,
    low_volume: 0,
    dormant: 0,
    never_used: 0,
    calls_30d_total: 0,
    answered_30d_total: 0,
    webhooks_unconfigured: 0,
  };
  for (const r of rows) {
    out.calls_30d_total += r.calls_30d ?? 0;
    out.answered_30d_total += r.answered_30d ?? 0;
    if (!r.webhook_configured) out.webhooks_unconfigured += 1;
    switch (r.health_status) {
      case "active":     out.active += 1; break;
      case "low_volume": out.low_volume += 1; break;
      case "dormant":    out.dormant += 1; break;
      case "never_used": out.never_used += 1; break;
    }
  }
  return out;
}

function emptySummary() {
  return {
    total: 0,
    active: 0,
    low_volume: 0,
    dormant: 0,
    never_used: 0,
    calls_30d_total: 0,
    answered_30d_total: 0,
    webhooks_unconfigured: 0,
  };
}
