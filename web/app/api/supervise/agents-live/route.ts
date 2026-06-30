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

  // 4) Agent handles for the users (needed for call stats lookup).
  const { data: handles } = await admin
    .from("agent_handles")
    .select("id, user_id")
    .eq("org_id", orgId)
    .eq("kind", "human")
    .in("user_id", userIds);
  const handleToUser = new Map<string, string>();
  const userToHandles = new Map<string, string[]>();
  for (const h of (handles ?? []) as Array<{ id: string; user_id: string }>) {
    handleToUser.set(h.id, h.user_id);
    const list = userToHandles.get(h.user_id) ?? [];
    list.push(h.id);
    userToHandles.set(h.user_id, list);
  }

  // 5) Pull every "in-flight" call referenced by a presence row.
  const callIds = Array.from(
    new Set(
      Array.from(presMap.values())
        .map((p) => p.current_call_id)
        .filter((id): id is string => !!id),
    ),
  );
  let callMap = new Map<string, { id: string; direction: string | null; started_at: string | null; answered_at: string | null; duration_secs: number | null; from_e164: string | null; to_e164: string | null; contact_name: string | null }>();
  if (callIds.length > 0) {
    const { data: calls } = await admin
      .from("calls")
      .select("id, direction, started_at, answered_at, duration_secs, from_e164, to_e164, contacts(display_name)")
      .in("id", callIds);
    callMap = new Map(
      ((calls ?? []) as unknown as Array<{
        id: string;
        direction: string | null;
        started_at: string | null;
        answered_at: string | null;
        duration_secs: number | null;
        from_e164: string | null;
        to_e164: string | null;
        contacts: { display_name: string | null }[] | { display_name: string | null } | null;
      }>).map((c) => {
        const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
        // Filter out LiveKit participant identities.
        const fromE164 = c.from_e164?.startsWith("client:") ? null : c.from_e164;
        return [
          c.id,
          {
            id: c.id,
            direction: c.direction,
            started_at: c.started_at,
            answered_at: c.answered_at,
            duration_secs: c.duration_secs,
            from_e164: fromE164,
            to_e164: c.to_e164,
            contact_name: contact?.display_name ?? null,
          },
        ];
      }),
    );

    // Secondary phone lookup for calls that have no contact name yet.
    const noName = Array.from(callMap.values()).filter((c) => !c.contact_name && (c.from_e164 || c.to_e164));
    if (noName.length > 0) {
      const phones = [...new Set(noName.flatMap((c) => [c.from_e164, c.to_e164]).filter((p): p is string => !!p))];
      const nameByPhone = new Map<string, string | null>();

      const { data: ctsRows } = await admin
        .from("contacts")
        .select("e164, display_name")
        .eq("org_id", orgId)
        .in("e164", phones);
      for (const ct of (ctsRows ?? []) as Array<{ e164: string; display_name: string | null }>) {
        if (ct.e164) nameByPhone.set(ct.e164, ct.display_name);
      }

      const missingPhones = phones.filter((p) => !nameByPhone.has(p));
      if (missingPhones.length > 0) {
        const { data: leadRows } = await admin
          .from("leads_rdv")
          .select("numero_telephone, nom")
          .in("numero_telephone", missingPhones);
        for (const l of (leadRows ?? []) as Array<{ numero_telephone: string | null; nom: string | null }>) {
          if (l.numero_telephone) nameByPhone.set(l.numero_telephone, l.nom);
        }
      }

      for (const call of callMap.values()) {
        if (!call.contact_name) {
          const phone = call.direction === "in" ? call.from_e164 : call.to_e164;
          if (phone && nameByPhone.has(phone)) {
            call.contact_name = nameByPhone.get(phone) ?? null;
          }
        }
      }
    }
  }

  // 6) Today's call stats per agent handle (calls answered today).
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const allHandleIds = Array.from(handleToUser.keys());
  const statsByUser = new Map<string, { calls_today: number; avg_duration_secs: number | null }>();
  if (allHandleIds.length > 0) {
    const { data: todayCalls } = await admin
      .from("calls")
      .select("agent_handle_id, duration_secs, answered_at")
      .eq("org_id", orgId)
      .in("agent_handle_id", allHandleIds)
      .gte("started_at", todayStart.toISOString())
      .in("state", ["ended", "in_progress", "wrap_up"]);
    const aggByHandle = new Map<string, { count: number; total_dur: number; dur_count: number }>();
    for (const c of (todayCalls ?? []) as Array<{ agent_handle_id: string | null; duration_secs: number | null; answered_at: string | null }>) {
      if (!c.agent_handle_id) continue;
      const agg = aggByHandle.get(c.agent_handle_id) ?? { count: 0, total_dur: 0, dur_count: 0 };
      agg.count++;
      if (c.answered_at && c.duration_secs != null) {
        agg.total_dur += c.duration_secs;
        agg.dur_count++;
      }
      aggByHandle.set(c.agent_handle_id, agg);
    }
    // Roll up per user (a user may have multiple handles).
    for (const [hid, agg] of aggByHandle) {
      const uid = handleToUser.get(hid);
      if (!uid) continue;
      const prev = statsByUser.get(uid) ?? { calls_today: 0, avg_duration_secs: null };
      const newCount = prev.calls_today + agg.count;
      const prevDurTotal = (prev.avg_duration_secs ?? 0) * (prev.calls_today > 0 ? prev.calls_today : 0);
      const newDurTotal = prevDurTotal + agg.total_dur;
      const newDurCount = (prev.avg_duration_secs != null ? prev.calls_today : 0) + agg.dur_count;
      statsByUser.set(uid, {
        calls_today: newCount,
        avg_duration_secs: newDurCount > 0 ? Math.round(newDurTotal / newDurCount) : null,
      });
    }
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
    const stats = statsByUser.get(uid) ?? null;
    return {
      user_id: uid,
      display_name: prof?.display_name ?? null,
      email: prof?.email ?? null,
      status,
      last_seen: p?.last_seen ?? null,
      stale_secs: Number.isFinite(staleSecs) ? staleSecs : null,
      current_call: call,
      stats_today: stats,
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
