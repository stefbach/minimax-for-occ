import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/**
 * GET /api/supervise/inbound-calls
 *
 * Inbound call list for the supervisor's dedicated inbound tracking page.
 * Defaults to today (UTC midnight → now). Supports ?from=ISO&to=ISO&state=...
 *
 * Returns:
 *   { calls: InboundCall[], kpis: KPIs, period: { from, to } }
 */
export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ calls: [], kpis: null, period: null });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const stateFilter = searchParams.get("state");
  const limit = Math.min(Number(searchParams.get("limit") ?? 300), 1000);

  // Default: today UTC
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const fromDate = searchParams.get("from") ?? todayStart.toISOString();
  const toDate = searchParams.get("to") ?? new Date().toISOString();

  const admin = supabaseServer();

  let q = admin
    .from("calls")
    .select(
      "id, state, from_e164, to_e164, started_at, answered_at, ended_at, duration_secs, disposition, metadata, agent_handle_id, contact_id, contacts(id, display_name, e164), agent_handles(id, display_name, kind)",
    )
    .eq("org_id", orgId)
    .eq("direction", "in")
    .gte("started_at", fromDate)
    .lte("started_at", toDate)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (stateFilter) {
    const states = stateFilter.split(",").map((s) => s.trim()).filter(Boolean);
    if (states.length > 0) q = q.in("state", states);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type RawCall = {
    id: string;
    state: string;
    from_e164: string | null;
    to_e164: string | null;
    started_at: string;
    answered_at: string | null;
    ended_at: string | null;
    duration_secs: number | null;
    disposition: string | null;
    metadata: { qualification?: string } | null;
    agent_handle_id: string | null;
    contact_id: string | null;
    contacts: { id: string; display_name: string | null; e164: string | null } | Array<{ id: string; display_name: string | null; e164: string | null }> | null;
    agent_handles: { id: string; display_name: string | null; kind: string } | Array<{ id: string; display_name: string | null; kind: string }> | null;
  };

  const calls = ((data ?? []) as RawCall[]).map((c) => {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
    const handle = Array.isArray(c.agent_handles) ? c.agent_handles[0] : c.agent_handles;
    return {
      id: c.id,
      state: c.state,
      from_e164: c.from_e164,
      to_e164: c.to_e164,
      started_at: c.started_at,
      answered_at: c.answered_at,
      ended_at: c.ended_at,
      duration_secs: c.duration_secs,
      disposition: c.disposition,
      qualification: c.metadata?.qualification ?? null,
      contact_id: contact?.id ?? null,
      contact_name: contact?.display_name ?? null,
      contact_e164: contact?.e164 ?? null,
      agent_name: handle?.display_name ?? null,
    };
  });

  // KPIs computed server-side to avoid shipping all rows twice.
  const total = calls.length;
  const answered = calls.filter((c) => c.answered_at !== null).length;
  const inProgress = calls.filter((c) => c.state === "ringing" || c.state === "in_progress").length;
  const missed = calls.filter(
    (c) => !c.answered_at && (c.state === "ended" || c.state === "failed"),
  ).length;
  const durSamples = calls.filter((c) => c.answered_at && c.duration_secs != null);
  const avgDuration =
    durSamples.length > 0
      ? Math.round(durSamples.reduce((s, c) => s + (c.duration_secs ?? 0), 0) / durSamples.length)
      : 0;
  const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;

  return NextResponse.json({
    calls,
    kpis: { total, answered, missed, in_progress: inProgress, avg_duration_secs: avgDuration, answer_rate: answerRate },
    period: { from: fromDate, to: toDate },
  });
}
