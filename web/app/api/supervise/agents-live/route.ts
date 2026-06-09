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
 * GET /api/supervise/agents-live
 *
 * Live presence + current call snapshot for every human agent in the
 * org. Used by /supervise/live (the supervisor's wallboard view).
 *
 * Output shape:
 *   {
 *     agents: [{
 *       user_id, display_name, email,
 *       status: "available" | "busy" | "away" | "offline" | "unknown",
 *       last_seen, stale_secs,
 *       current_call: { id, started_at, answered_at, duration_secs, to_e164,
 *                       contact_name } | null
 *     }],
 *     totals: { online, available, on_call, idle_too_long },
 *     server_now
 *   }
 *
 * Heuristic: an agent whose last_seen is older than 60s gets demoted to
 * "offline" regardless of their stored status — the softphone heartbeat
 * runs every 25s, so a 60s gap means they closed the tab.
 */

const HEARTBEAT_STALE_SECS = 60;

export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ agents: [], totals: zeroTotals(), server_now: new Date().toISOString() });
  }
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();

  // 1) Membership-defined human agents in this org (agent + supervisor +
  //    manager roles can all take calls per the desk/agents route).
  const { data: mems } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["agent", "supervisor", "manager"]);
  const userIds = (mems ?? []).map((m) => (m as { user_id: string }).user_id);
  if (userIds.length === 0) {
    return NextResponse.json({ agents: [], totals: zeroTotals(), server_now: new Date().toISOString() });
  }

  // 2) Profiles for display_name + email.
  const { data: profs } = await admin
    .from("profiles")
    .select("user_id, display_name, email")
    .in("user_id", userIds);
  const profMap = new Map<string, { display_name: string | null; email: string | null }>();
  for (const p of (profs ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
    profMap.set(p.user_id, { display_name: p.display_name, email: p.email });
  }

  // 3) Presence rows.
  const { data: pres } = await admin
    .from("human_presence")
    .select("user_id, status, last_seen, current_call_id")
    .eq("org_id", orgId)
    .in("user_id", userIds);
  const presMap = new Map<string, { status: string; last_seen: string; current_call_id: string | null }>();
  for (const p of (pres ?? []) as Array<{ user_id: string; status: string; last_seen: string; current_call_id: string | null }>) {
    presMap.set(p.user_id, p);
  }

  // 4) Pull every "in-flight" call referenced by a presence row.
  const callIds = Array.from(
    new Set(
      Array.from(presMap.values())
        .map((p) => p.current_call_id)
        .filter((id): id is string => !!id),
    ),
  );
  let callMap = new Map<string, { id: string; started_at: string | null; answered_at: string | null; duration_secs: number | null; to_e164: string | null; contact_name: string | null }>();
  if (callIds.length > 0) {
    const { data: calls } = await admin
      .from("calls")
      .select("id, started_at, answered_at, duration_secs, to_e164, contacts(display_name)")
      .in("id", callIds);
    callMap = new Map(
      ((calls ?? []) as unknown as Array<{
        id: string;
        started_at: string | null;
        answered_at: string | null;
        duration_secs: number | null;
        to_e164: string | null;
        contacts: { display_name: string | null }[] | { display_name: string | null } | null;
      }>).map((c) => {
        const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
        return [
          c.id,
          {
            id: c.id,
            started_at: c.started_at,
            answered_at: c.answered_at,
            duration_secs: c.duration_secs,
            to_e164: c.to_e164,
            contact_name: contact?.display_name ?? null,
          },
        ];
      }),
    );
  }

  const now = Date.now();
  const agents = userIds.map((uid) => {
    const prof = profMap.get(uid);
    const p = presMap.get(uid);
    const last = p ? Date.parse(p.last_seen) : NaN;
    const staleSecs = Number.isFinite(last) ? Math.floor((now - last) / 1000) : Number.POSITIVE_INFINITY;
    const stored = p?.status ?? "unknown";
    // Demote to offline if heartbeat is stale (tab closed).
    const status: AgentStatus =
      staleSecs > HEARTBEAT_STALE_SECS
        ? "offline"
        : (stored as AgentStatus);
    const call = p?.current_call_id ? callMap.get(p.current_call_id) ?? null : null;
    return {
      user_id: uid,
      display_name: prof?.display_name ?? null,
      email: prof?.email ?? null,
      status,
      last_seen: p?.last_seen ?? null,
      stale_secs: Number.isFinite(staleSecs) ? staleSecs : null,
      current_call: call,
    };
  });

  const totals = {
    online: agents.filter((a) => a.status !== "offline" && a.status !== "unknown").length,
    available: agents.filter((a) => a.status === "available").length,
    on_call: agents.filter((a) => a.current_call !== null).length,
    idle_too_long: agents.filter((a) => a.status === "away").length,
  };

  // Sort: on-call first, then available, then away, then offline.
  const order: Record<AgentStatus, number> = {
    busy: 0,
    available: 1,
    away: 2,
    offline: 3,
    unknown: 4,
  };
  agents.sort((a, b) => {
    if (a.current_call && !b.current_call) return -1;
    if (b.current_call && !a.current_call) return 1;
    return (order[a.status] ?? 99) - (order[b.status] ?? 99);
  });

  return NextResponse.json({ agents, totals, server_now: new Date().toISOString() });
}

type AgentStatus = "available" | "busy" | "away" | "offline" | "unknown";

function zeroTotals() {
  return { online: 0, available: 0, on_call: 0, idle_too_long: 0 };
}
