import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/queue
 *
 * Returns the two lists the desk's left & right panes need:
 *
 *   {
 *     personal: DeskCall[],   // "Mes appels du jour"
 *     shared:   DeskCall[],   // "Pool partagé"
 *   }
 *
 * Personal  = calls.metadata.assigned_to == current_user_id
 *             AND metadata.human_callback_at::date == today (or no date).
 * Shared    = disposition mentions humain/rappel AND assigned_to is null
 *             AND (human_callback_at <= today OR null).
 *
 * Each row joins the contact for display name + count of previous calls
 * and pulls the most recent note from metadata.note (best-effort).
 *
 * Multi-tenant: every query is filtered by org_id derived from the
 * caller's cookie / membership.
 */

interface DeskCall {
  id: string;
  e164: string | null;
  display_name: string | null;
  last_call_at: string | null;
  disposition: string | null;
  qualification: string | null;
  call_count: number;
  last_note: string | null;
  human_callback_at: string | null;
  assigned_to: string | null;
}

export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ personal: [], shared: [] });
  }

  const sbSession = await supabaseSession();
  const { data: auth } = await sbSession.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orgId = await requestOrgId(req);

  const admin = supabaseServer();

  // Today's date in UTC. The metadata.human_callback_at is stored as ISO,
  // we filter via a JSON cast in SQL (no helper for this in supabase-js, so
  // we pull a generous slice — up to today inclusive — and post-filter in
  // JS).
  const todayEnd = endOfTodayUtc();

  // Heuristic dispositions that mean "should land in a human queue".
  // We use ilike with %humain% / %rappel% — fits the FR-language tagging
  // the IA agents apply today (e.g. "transfert_humain", "rappel_humain",
  // "rappel_planifie").
  const baseSelect =
    "id, to_e164, from_e164, direction, started_at, ended_at, disposition, contact_id, metadata, contacts(id, display_name, e164)";

  // PERSONAL — assigned_to == user.id, today only.
  const { data: personalRaw, error: pErr } = await admin
    .from("calls")
    .select(baseSelect)
    .eq("org_id", orgId)
    .filter("metadata->>assigned_to", "eq", user.id)
    .order("started_at", { ascending: false })
    .limit(200);
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  // SHARED — disposition ilike %humain% or %rappel%, assigned_to is null,
  // callback within today (or unset). Supabase OR filters need string form.
  const { data: sharedRaw, error: sErr } = await admin
    .from("calls")
    .select(baseSelect)
    .eq("org_id", orgId)
    .filter("metadata->>assigned_to", "is", null)
    .or("disposition.ilike.%humain%,disposition.ilike.%rappel%")
    .order("started_at", { ascending: false })
    .limit(200);
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const personal = (personalRaw ?? []).filter((r) =>
    keepForToday(r as Row, todayEnd, /*todayOnly*/ true),
  );
  const shared = (sharedRaw ?? []).filter((r) =>
    keepForToday(r as Row, todayEnd, /*todayOnly*/ false),
  );

  // Collect contact_ids for call_count enrichment in a single query.
  const contactIds = Array.from(
    new Set(
      [...personal, ...shared]
        .map((r) => (r as Row).contact_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const callCounts: Record<string, number> = {};
  if (contactIds.length > 0) {
    // We use a coarse query — count per contact via a select+aggregate is
    // awkward in supabase-js; pull the ids and bucket-count in JS. With a
    // limit of 2 000 (200 personal + 200 shared ⇒ ~400 distinct contacts ⇒
    // their lifetime call rows can easily exceed 1 000, but for the
    // sidebar a "10+" approximation is fine).
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

  return NextResponse.json({
    personal: personal.map((r) => toDeskCall(r as Row, callCounts)),
    shared: shared.map((r) => toDeskCall(r as Row, callCounts)),
  });
}

type Row = {
  id: string;
  to_e164: string | null;
  from_e164: string | null;
  direction: "in" | "out";
  started_at: string;
  ended_at: string | null;
  disposition: string | null;
  contact_id: string | null;
  metadata: Record<string, unknown> | null;
  contacts: { id: string; display_name: string | null; e164: string } | { id: string; display_name: string | null; e164: string }[] | null;
};

function endOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function keepForToday(r: Row, todayEnd: Date, todayOnly: boolean): boolean {
  const cb = (r.metadata as Record<string, unknown> | null)?.[
    "human_callback_at"
  ] as string | null | undefined;
  if (!cb) return true; // no callback date → always include
  const t = Date.parse(cb);
  if (!Number.isFinite(t)) return true;
  if (t > todayEnd.getTime()) return false; // future, beyond today → skip
  if (todayOnly) {
    // For "personal", we want today-only — drop strictly older callbacks
    // (older callbacks landed in the shared pool already; if the user
    // still owns them they're stale work).
    const startOfToday = new Date(todayEnd);
    startOfToday.setUTCHours(0, 0, 0, 0);
    return t >= startOfToday.getTime();
  }
  return true; // shared pool: anything up to today is in.
}

function toDeskCall(r: Row, callCounts: Record<string, number>): DeskCall {
  const contact = Array.isArray(r.contacts) ? r.contacts[0] ?? null : r.contacts;
  const md = (r.metadata ?? {}) as Record<string, unknown>;
  const e164 =
    r.direction === "in" ? r.from_e164 : r.to_e164 ?? contact?.e164 ?? null;
  const notesArr = Array.isArray(md.notes) ? (md.notes as unknown[]) : null;
  const lastNote =
    (typeof md.note === "string" ? (md.note as string) : null) ||
    (notesArr && notesArr.length > 0
      ? typeof notesArr[notesArr.length - 1] === "string"
        ? (notesArr[notesArr.length - 1] as string)
        : (notesArr[notesArr.length - 1] as { text?: string })?.text ?? null
      : null);
  return {
    id: r.id,
    e164,
    display_name: contact?.display_name ?? null,
    last_call_at: r.ended_at ?? r.started_at,
    disposition: r.disposition ?? null,
    qualification: (typeof md.qualification === "string" ? (md.qualification as string) : null),
    call_count: r.contact_id ? callCounts[r.contact_id] ?? 1 : 1,
    last_note: typeof lastNote === "string" ? lastNote : null,
    human_callback_at:
      typeof md.human_callback_at === "string"
        ? (md.human_callback_at as string)
        : null,
    assigned_to:
      typeof md.assigned_to === "string" ? (md.assigned_to as string) : null,
  };
}
