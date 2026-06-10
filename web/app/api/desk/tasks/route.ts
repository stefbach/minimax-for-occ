import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/tasks?date=YYYY-MM-DD
 *
 * Returns three lists for the "Appels du jour" desk:
 *
 *   personal:    assigned_to = me, scheduled_for::date = date,
 *                status IN ('pending','in_progress')
 *   shared:      assigned_to IS NULL, scheduled_for::date = date,
 *                status = 'pending'
 *   done_today:  assigned_to = me, status = 'done',
 *                updated_at::date = today (UTC)
 *
 * Each row joins contacts(display_name, e164) and counts past calls for
 * the contact (best-effort, 1 if no history).
 */

interface DeskTask {
  id: string;
  org_id: string;
  contact: { id: string | null; display_name: string | null; e164: string | null };
  qualification: string | null;
  transfer_reason: string | null;
  scheduled_for: string;
  assigned_to: string | null;
  status: string;
  notes: string | null;
  outcome_disposition: string | null;
  call_count: number;
  original_call_summary: string | null;
  original_call_id: string | null;
  last_note: string | null;
  created_at: string;
  updated_at: string;
}

const TASK_SELECT =
  "id, org_id, contact_id, original_call_id, transferred_by_agent_id, qualification, transfer_reason, scheduled_for, assigned_to, status, notes, outcome_call_id, outcome_disposition, created_at, updated_at, contacts(id, display_name, e164)";

export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ personal: [], shared: [], done_today: [] });
  }
  const sbSession = await supabaseSession();
  const { data: auth } = await sbSession.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orgId = await requestOrgId(req);

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const scope = url.searchParams.get("scope"); // "all" → supervisor view
  const date = parseDate(dateParam) ?? utcTodayDate();
  const dayStart = startOfDayUtc(date);
  const dayEnd = endOfDayUtc(date);
  const todayStart = startOfDayUtc(utcTodayDate());
  const todayEnd = endOfDayUtc(utcTodayDate());

  const admin = supabaseServer();

  // ── supervisor "all" view ─────────────────────────────────────────────
  if (scope === "all") {
    const role = await currentRoleInOrg(orgId);
    if (!role || !SUPERVISOR_ROLES.has(role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Optional `lookahead_days` widens the window from a single day to
    // [today, today + N days]. Lets a manager land on "everything coming
    // up this week" instead of having to scrub the date picker forward
    // when today is empty (Wati June 10: Sarah was scheduled for
    // tomorrow, Sabina for the day after, and Summer the manager saw
    // 'Aucune tâche' on the default today view).
    const lookahead = Number(url.searchParams.get("lookahead_days") ?? "0");
    const rangeEnd = lookahead > 0
      ? endOfDayUtc(addDays(utcTodayDate(), Math.min(60, Math.max(1, lookahead))))
      : dayEnd;
    const rangeStart = lookahead > 0 ? startOfDayUtc(utcTodayDate()) : dayStart;
    const { data: allRaw, error: aErr } = await admin
      .from("human_callback_tasks")
      .select(TASK_SELECT)
      .eq("org_id", orgId)
      .gte("scheduled_for", rangeStart.toISOString())
      .lte("scheduled_for", rangeEnd.toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(500);
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    return NextResponse.json({ all: (allRaw ?? []).map(rowToTask) });
  }

  // ── personal ──────────────────────────────────────────────────────────
  const { data: personalRaw, error: pErr } = await admin
    .from("human_callback_tasks")
    .select(TASK_SELECT)
    .eq("org_id", orgId)
    .eq("assigned_to", user.id)
    .in("status", ["pending", "in_progress"])
    .gte("scheduled_for", dayStart.toISOString())
    .lte("scheduled_for", dayEnd.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // ── shared ────────────────────────────────────────────────────────────
  const { data: sharedRaw, error: sErr } = await admin
    .from("human_callback_tasks")
    .select(TASK_SELECT)
    .eq("org_id", orgId)
    .is("assigned_to", null)
    .eq("status", "pending")
    .gte("scheduled_for", dayStart.toISOString())
    .lte("scheduled_for", dayEnd.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // ── done_today ────────────────────────────────────────────────────────
  const { data: doneRaw, error: dErr } = await admin
    .from("human_callback_tasks")
    .select(TASK_SELECT)
    .eq("org_id", orgId)
    .eq("assigned_to", user.id)
    .eq("status", "done")
    .gte("updated_at", todayStart.toISOString())
    .lte("updated_at", todayEnd.toISOString())
    .order("updated_at", { ascending: false })
    .limit(200);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const allRows = [
    ...(personalRaw ?? []),
    ...(sharedRaw ?? []),
    ...(doneRaw ?? []),
  ] as Row[];

  // Bulk-load call counts per contact and the original-call summary for
  // each task in one round-trip each.
  const contactIds = Array.from(
    new Set(allRows.map((r) => r.contact_id).filter((v): v is string => Boolean(v))),
  );
  const callIds = Array.from(
    new Set(
      allRows.map((r) => r.original_call_id).filter((v): v is string => Boolean(v)),
    ),
  );

  const callCounts: Record<string, number> = {};
  if (contactIds.length > 0) {
    const { data: hist } = await admin
      .from("calls")
      .select("contact_id")
      .eq("org_id", orgId)
      .in("contact_id", contactIds)
      .limit(5000);
    for (const row of hist ?? []) {
      const c = (row as { contact_id: string | null }).contact_id;
      if (c) callCounts[c] = (callCounts[c] ?? 0) + 1;
    }
  }

  const callSummaries: Record<string, string | null> = {};
  if (callIds.length > 0) {
    const { data: cs } = await admin
      .from("calls")
      .select("id, summary")
      .eq("org_id", orgId)
      .in("id", callIds);
    for (const row of cs ?? []) {
      const r = row as { id: string; summary: string | null };
      callSummaries[r.id] = r.summary;
    }
  }

  const toTask = (r: Row): DeskTask => {
    const contact = Array.isArray(r.contacts)
      ? r.contacts[0] ?? null
      : r.contacts;
    return {
      id: r.id,
      org_id: r.org_id,
      contact: {
        id: contact?.id ?? r.contact_id,
        display_name: contact?.display_name ?? null,
        e164: contact?.e164 ?? null,
      },
      qualification: r.qualification,
      transfer_reason: r.transfer_reason,
      scheduled_for: r.scheduled_for,
      assigned_to: r.assigned_to,
      status: r.status,
      notes: r.notes,
      outcome_disposition: r.outcome_disposition,
      call_count: r.contact_id ? callCounts[r.contact_id] ?? 1 : 1,
      original_call_summary: r.original_call_id
        ? callSummaries[r.original_call_id] ?? null
        : null,
      original_call_id: r.original_call_id,
      last_note: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  };

  return NextResponse.json({
    personal: (personalRaw ?? []).map((r) => toTask(r as Row)),
    shared: (sharedRaw ?? []).map((r) => toTask(r as Row)),
    done_today: (doneRaw ?? []).map((r) => toTask(r as Row)),
  });
}

type Row = {
  id: string;
  org_id: string;
  contact_id: string | null;
  original_call_id: string | null;
  qualification: string | null;
  transfer_reason: string | null;
  scheduled_for: string;
  assigned_to: string | null;
  status: string;
  notes: string | null;
  outcome_disposition: string | null;
  created_at: string;
  updated_at: string;
  contacts:
    | { id: string; display_name: string | null; e164: string | null }
    | { id: string; display_name: string | null; e164: string | null }[]
    | null;
};

// Lightweight Row → DeskTask conversion for the supervisor "scope=all"
// view, where we don't need per-contact call counts or original-call
// summaries to keep the table snappy.
function rowToTask(raw: unknown): DeskTask {
  const r = raw as Row;
  const contact = Array.isArray(r.contacts) ? r.contacts[0] ?? null : r.contacts;
  return {
    id: r.id,
    org_id: r.org_id,
    contact: {
      id: contact?.id ?? r.contact_id,
      display_name: contact?.display_name ?? null,
      e164: contact?.e164 ?? null,
    },
    qualification: r.qualification,
    transfer_reason: r.transfer_reason,
    scheduled_for: r.scheduled_for,
    assigned_to: r.assigned_to,
    status: r.status,
    notes: r.notes,
    outcome_disposition: r.outcome_disposition,
    call_count: 1,
    original_call_summary: null,
    original_call_id: r.original_call_id,
    last_note: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  // Accept YYYY-MM-DD.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

function utcTodayDate(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}
