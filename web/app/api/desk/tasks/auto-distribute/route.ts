import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/tasks/auto-distribute
 *
 * Round-robin assignment of today's unassigned `pending` callback tasks
 * to active human agents in the org. Designed to run once per UTC day
 * per org — debounced via organizations.last_distribution_at_utc_date.
 *
 * Called silently on first /desk mount each morning. Idempotent.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ ok: true, skipped: "no-supabase" });
  }
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const todayUtcDate = utcDateString(new Date());

  // ── debounce ──────────────────────────────────────────────────────────
  const { data: org, error: oErr } = await admin
    .from("organizations")
    .select("id, last_distribution_at_utc_date")
    .eq("id", orgId)
    .maybeSingle();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!org) return NextResponse.json({ error: "org not found" }, { status: 404 });
  if (org.last_distribution_at_utc_date === todayUtcDate) {
    return NextResponse.json({ ok: true, skipped: "already-ran-today" });
  }

  // ── load today's unassigned pending tasks (sorted by created_at) ──────
  const dayStart = startOfDayUtc(new Date()).toISOString();
  const dayEnd = endOfDayUtc(new Date()).toISOString();
  const { data: pending, error: pErr } = await admin
    .from("human_callback_tasks")
    .select("id, assigned_to, created_at, e164")
    .eq("org_id", orgId)
    .is("assigned_to", null)
    .eq("status", "pending")
    .gte("scheduled_for", dayStart)
    .lte("scheduled_for", dayEnd)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  if (!pending || pending.length === 0) {
    // Stamp the date anyway so we don't re-run for nothing.
    await admin
      .from("organizations")
      .update({ last_distribution_at_utc_date: todayUtcDate })
      .eq("id", orgId);
    return NextResponse.json({ ok: true, assigned: 0, agents: 0 });
  }

  // ── load active human agents ──────────────────────────────────────────
  // role='agent' AND profiles.is_active=true. We deterministically sort
  // by user_id so the round-robin is stable across runs.
  const { data: memberships, error: mErr } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .eq("role", "agent");
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const agentIds = (memberships ?? [])
    .map((m) => (m as { user_id: string }).user_id)
    .filter((v): v is string => Boolean(v));

  let activeAgents: string[] = [];
  if (agentIds.length > 0) {
    const { data: profs, error: prErr } = await admin
      .from("profiles")
      .select("id, is_active")
      .in("id", agentIds);
    if (prErr) return NextResponse.json({ error: prErr.message }, { status: 500 });
    const activeSet = new Set(
      (profs ?? [])
        .filter((p) => (p as { is_active: boolean | null }).is_active !== false)
        .map((p) => (p as { id: string }).id),
    );
    // If a profile row is missing entirely (rare), treat the user as
    // active — better to distribute than to leave a task stranded.
    activeAgents = agentIds
      .filter((id) => activeSet.has(id) || !(profs ?? []).some((p) => (p as { id: string }).id === id))
      .sort();
  }

  if (activeAgents.length === 0) {
    await admin
      .from("organizations")
      .update({ last_distribution_at_utc_date: todayUtcDate })
      .eq("id", orgId);
    return NextResponse.json({ ok: true, assigned: 0, agents: 0 });
  }

  // ── round-robin ───────────────────────────────────────────────────────
  const total = pending.length;
  const agentCount = activeAgents.length;
  const perAgentCap = Math.ceil(total / agentCount);

  // Count existing assignments today per agent (to respect the cap when
  // a partial run has already distributed some).
  const { data: alreadyAssigned } = await admin
    .from("human_callback_tasks")
    .select("assigned_to")
    .eq("org_id", orgId)
    .in("status", ["pending", "in_progress"])
    .gte("scheduled_for", dayStart)
    .lte("scheduled_for", dayEnd)
    .not("assigned_to", "is", null);
  const counts: Record<string, number> = {};
  for (const a of activeAgents) counts[a] = 0;
  for (const row of alreadyAssigned ?? []) {
    const u = (row as { assigned_to: string | null }).assigned_to;
    if (u && counts[u] !== undefined) counts[u] += 1;
  }

  let cursor = 0;
  let assigned = 0;
  const updates: { id: string; user: string }[] = [];
  for (const task of pending) {
    // Pick the next agent that isn't capped. We rotate cursor and skip
    // any whose counts[a] >= perAgentCap.
    let chosen: string | null = null;
    for (let i = 0; i < agentCount; i++) {
      const candidate = activeAgents[(cursor + i) % agentCount];
      if (counts[candidate] < perAgentCap) {
        chosen = candidate;
        cursor = (cursor + i + 1) % agentCount;
        break;
      }
    }
    if (!chosen) break; // all capped
    counts[chosen] += 1;
    assigned += 1;
    updates.push({ id: (task as { id: string }).id, user: chosen });
  }

  // Persist the updates. We do them sequentially — round-robin is small
  // (dozens to low hundreds in v1) and Postgres can absorb it.
  const taskById = new Map(
    (pending as { id: string; e164?: string | null }[]).map((t) => [t.id, t]),
  );
  for (const u of updates) {
    await admin
      .from("human_callback_tasks")
      .update({
        assigned_to: u.user,
        // Keep status as 'pending' — the human agent will flip it to
        // 'in_progress' when they actually start the call.
        updated_at: new Date().toISOString(),
      })
      .eq("id", u.id)
      .eq("org_id", orgId);
    // Sync assigned_to → leads_rdv.agent for platform-wide coherence.
    const phone = taskById.get(u.id)?.e164 ?? null;
    if (phone) {
      try {
        await admin.from("leads_rdv" as never).update({ agent: u.user })
          .eq("numero_telephone", phone);
      } catch { /* non-fatal */ }
    }
  }

  // Stamp the run.
  await admin
    .from("organizations")
    .update({ last_distribution_at_utc_date: todayUtcDate })
    .eq("id", orgId);

  return NextResponse.json({
    ok: true,
    assigned,
    agents: agentCount,
    total,
  });
}

function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDayUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}
function endOfDayUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}
