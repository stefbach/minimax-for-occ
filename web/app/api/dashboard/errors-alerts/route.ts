import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { leadNameMapFor, leadNameForPhone } from "@/lib/leads-source";
import { cleanPhone, cleanName } from "@/lib/phone-clean";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Erreurs & Alertes" dashboard tab — surfaces:
//   1. dashboard_errors rows (system error log, org-scoped)
//   2. Voicemail / répondeur calls in the last 24h (to call back)
//   3. Robot-awareness calls (priority human callback)
//   4. Anomalies: numbers never reached + contacts with 3+ failed attempts
// All queries are org_id-scoped. Missing columns or empty tables yield zeros.

export type ErrorRow = {
  id: string;
  error_type: string;
  message: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};

export type CallbackRow = {
  call_id: string;
  contact_name: string | null;
  e164: string | null;
  duration_secs: number | null;
  disposition: string | null;
  ended_at: string | null;
};

export type RobotRow = {
  call_id: string;
  contact_name: string | null;
  e164: string | null;
  disposition: string | null;
  ended_at: string | null;
};

export type NeverReachedRow = {
  to_e164: string;
  contact_name: string | null;
  attempts: number;
};

export type ThreeAttemptsRow = {
  contact_id: string;
  contact_name: string | null;
  e164: string | null;
  attempts: number;
};

export type ErrorsAlertsResponse = {
  errors: ErrorRow[];
  error_types: string[];
  callbacks: CallbackRow[];
  callbacks_count: number;
  robot_awareness: RobotRow[];
  never_reached: NeverReachedRow[];
  three_attempts: ThreeAttemptsRow[];
};

const VOICEMAIL_RE = /repondeur|répondeur|voicemail|voice mail|mailbox/i;
const ROBOT_RE = /robot|automate|automatique|bot/i;

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const sb = supabaseServer();
  const url = new URL(request.url);
  const errorType = url.searchParams.get("error_type");
  const errorFromDate = url.searchParams.get("from");

  // ── 1. Error log ────────────────────────────────────────────────────────
  let errors: ErrorRow[] = [];
  let errorTypes: string[] = [];
  try {
    let q = sb
      .from("dashboard_errors")
      .select("id, error_type, message, occurred_at, metadata")
      .eq("org_id", orgId)
      .order("occurred_at", { ascending: false })
      .limit(50);
    if (errorType && errorType !== "all") q = q.eq("error_type", errorType);
    if (errorFromDate) q = q.gte("occurred_at", errorFromDate);
    const { data } = await q;
    errors = (data ?? []) as ErrorRow[];
    // distinct types for the filter dropdown (org-scoped)
    const { data: tdata } = await sb
      .from("dashboard_errors")
      .select("error_type")
      .eq("org_id", orgId)
      .limit(500);
    errorTypes = Array.from(
      new Set((tdata ?? []).map((r) => (r as { error_type: string }).error_type)),
    ).sort();
  } catch {
    // Table missing or query failed — degrade to empty.
    errors = [];
    errorTypes = [];
  }

  // ── 2 + 3. Recent calls (24h) for voicemail + robot triage ──────────────
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const callbacks: CallbackRow[] = [];
  const robotRows: RobotRow[] = [];
  // Resolve names from the CRM leads (prod + test) so voicemails/anomalies show
  // a person instead of "Unknown" — Axon/Retell calls have no linked contact.
  const [prodNames, testNames] = await Promise.all([leadNameMapFor("prod"), leadNameMapFor("test")]);
  const leadNames = new Map(prodNames);
  for (const [k, v] of testNames) if (!leadNames.has(k)) leadNames.set(k, v);
  try {
    const { data: callsData } = await sb
      .from("calls")
      .select(
        "id, to_e164, from_e164, direction, state, duration_secs, disposition, ended_at, metadata, contact_id, contacts(display_name, e164)",
      )
      .eq("org_id", orgId)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);
    const rows = (callsData ?? []) as unknown as Array<{
      id: string;
      to_e164: string | null;
      from_e164: string | null;
      direction: string | null;
      state: string | null;
      duration_secs: number | null;
      disposition: string | null;
      ended_at: string | null;
      metadata: Record<string, unknown> | null;
      contacts:
        | { display_name: string | null; e164: string | null }
        | Array<{ display_name: string | null; e164: string | null }>
        | null;
    }>;
    for (const r of rows) {
      const recalled = r.metadata && (r.metadata as Record<string, unknown>).recalled_at;
      const disp = (r.disposition || "").toString();
      const robotFlag =
        (r.metadata && (r.metadata as Record<string, unknown>).robot_awareness === "true") ||
        (r.metadata && (r.metadata as Record<string, unknown>).robot_awareness === true);
      const e164 = cleanPhone((r.direction === "in" || r.direction === "inbound") ? r.from_e164 : r.to_e164);
      const contact = Array.isArray(r.contacts) ? r.contacts[0] ?? null : r.contacts;
      const name = cleanName(contact?.display_name) ?? leadNameForPhone(e164, leadNames);
      if (ROBOT_RE.test(disp) || robotFlag) {
        robotRows.push({
          call_id: r.id,
          contact_name: name,
          e164,
          disposition: r.disposition,
          ended_at: r.ended_at,
        });
        continue;
      }
      const isVoicemail = VOICEMAIL_RE.test(disp);
      const isShort = (r.duration_secs ?? 0) <= 5 && r.state === "ended";
      if ((isVoicemail || isShort) && !recalled) {
        callbacks.push({
          call_id: r.id,
          contact_name: name,
          e164,
          duration_secs: r.duration_secs,
          disposition: r.disposition,
          ended_at: r.ended_at,
        });
      }
    }
  } catch {
    // best-effort
  }

  // ── 4. Anomalies ────────────────────────────────────────────────────────
  // 4a. "Numéro jamais joint": group by to_e164 over the last 30d, where no
  //     call to that number was answered, count >= 3.
  const lookback = new Date(Date.now() - 30 * 86400_000).toISOString();
  const neverReachedMap = new Map<string, { attempts: number; everAnswered: boolean }>();
  const contactAttemptsMap = new Map<string, { attempts: number; everAnswered: boolean }>();
  try {
    const { data: callsData } = await sb
      .from("calls")
      .select("to_e164, contact_id, answered_at, direction")
      .eq("org_id", orgId)
      .eq("direction", "out")
      .gte("started_at", lookback)
      .limit(20000);
    for (const r of (callsData ?? []) as Array<{
      to_e164: string | null;
      contact_id: string | null;
      answered_at: string | null;
    }>) {
      const answered = !!r.answered_at;
      const toClean = cleanPhone(r.to_e164);
      if (toClean) {
        const cur = neverReachedMap.get(toClean) ?? { attempts: 0, everAnswered: false };
        cur.attempts += 1;
        cur.everAnswered = cur.everAnswered || answered;
        neverReachedMap.set(toClean, cur);
      }
      if (r.contact_id) {
        const cur = contactAttemptsMap.get(r.contact_id) ?? { attempts: 0, everAnswered: false };
        cur.attempts += 1;
        cur.everAnswered = cur.everAnswered || answered;
        contactAttemptsMap.set(r.contact_id, cur);
      }
    }
  } catch {
    // best-effort
  }
  const neverReached: NeverReachedRow[] = Array.from(neverReachedMap.entries())
    .filter(([, v]) => !v.everAnswered && v.attempts >= 3)
    .map(([to_e164, v]) => ({ to_e164, contact_name: leadNameForPhone(to_e164, leadNames), attempts: v.attempts }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 100);

  // Resolve contact info for the 3-attempts group
  const candidateContacts = Array.from(contactAttemptsMap.entries()).filter(
    ([, v]) => !v.everAnswered && v.attempts >= 3,
  );
  const contactIds = candidateContacts.map(([id]) => id).slice(0, 50);
  let contactsMap = new Map<string, { display_name: string | null; e164: string | null }>();
  if (contactIds.length > 0) {
    try {
      const { data } = await sb
        .from("contacts")
        .select("id, display_name, e164")
        .in("id", contactIds);
      for (const c of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        e164: string | null;
      }>) {
        contactsMap.set(c.id, { display_name: c.display_name, e164: c.e164 });
      }
    } catch {
      contactsMap = new Map();
    }
  }
  const threeAttempts: ThreeAttemptsRow[] = candidateContacts
    .map(([contact_id, v]) => {
      const e164 = cleanPhone(contactsMap.get(contact_id)?.e164 ?? null);
      return {
        contact_id,
        contact_name: cleanName(contactsMap.get(contact_id)?.display_name) ?? leadNameForPhone(e164, leadNames),
        e164,
        attempts: v.attempts,
      };
    })
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 50);

  const body: ErrorsAlertsResponse = {
    errors,
    error_types: errorTypes,
    callbacks,
    callbacks_count: callbacks.length,
    robot_awareness: robotRows,
    never_reached: neverReached,
    three_attempts: threeAttempts,
  };
  return NextResponse.json(body);
}
