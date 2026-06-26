import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent-tools/schedule-callback
 *
 * Called by the IA agent (Charlotte) when a patient asks to be called back at a
 * SPECIFIC date/time. We stamp the lead's `leads_rdv` row with
 * `qualification = 'RAPPEL'` + `rappel_rdv = <requested time, UTC>` — exactly
 * what the dialer's callback engine + the exact-time callback runner dial.
 *
 * Auth: Bearer INTERNAL_AGENT_API_TOKEN (server-side agent, no user session).
 *
 * Body:
 *   {
 *     org_id?: string,            // tenant (optional — leads_rdv is single-tenant)
 *     e164?: string,             // patient phone; else resolved from original_call_id
 *     original_call_id?: string,  // the IA call (to resolve the phone if e164 absent)
 *     date: "YYYY-MM-DD",         // requested day (UK)
 *     time: "HH:MM",             // requested time (UK, 24h)
 *     reason?: string             // free text note
 *   }
 *
 * Policy (Wati): the call goes out at the EXACT requested time, but clamped to
 * sane calling hours — 08:00–21:00 UK. A request outside that is moved to the
 * nearest bound. Times are interpreted as Europe/London wall-clock (DST-aware)
 * and stored as UTC.
 */

const MIN_MIN = 8 * 60; // 08:00 UK
const MAX_MIN = 21 * 60; // 21:00 UK

// Offset (ms) to ADD to a UTC instant to get Europe/London wall-clock.
function ukOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, m.hour === 24 ? 0 : m.hour, m.minute, m.second);
  return asUtc - instant.getTime();
}

// Convert a Europe/London wall-clock (y, mo[1-12], d, h, mi) to a UTC Date.
function ukWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi); // treat the wall-clock as if UTC
  const off = ukOffsetMs(new Date(guess));     // London offset at ~that instant
  return new Date(guess - off);
}

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // ── auth ──
  const expected = process.env.INTERNAL_AGENT_API_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "INTERNAL_AGENT_API_TOKEN not set" }, { status: 500 });
  }
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  if (!m || m[1] !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── body ──
  const body = (await req.json().catch(() => null)) as {
    org_id?: string;
    e164?: string;
    original_call_id?: string | null;
    date?: string;
    time?: string;
    reason?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const dateM = /^(\d{4})-(\d{2})-(\d{2})$/.exec((body.date ?? "").trim());
  const timeM = /^(\d{1,2}):(\d{2})$/.exec((body.time ?? "").trim());
  if (!dateM || !timeM) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) and time (HH:MM) required" }, { status: 400 });
  }
  const [, ys, mos, ds] = dateM;
  const [, hs, mis] = timeM;
  const y = Number(ys), mo = Number(mos), d = Number(ds);
  let h = Number(hs), mi = Number(mis);

  // Clamp to 08:00–21:00 UK (nearest bound).
  const reqMin = h * 60 + mi;
  if (reqMin < MIN_MIN) { h = 8; mi = 0; }
  else if (reqMin > MAX_MIN) { h = 21; mi = 0; }

  const scheduledUtc = ukWallClockToUtc(y, mo, d, h, mi);
  if (Number.isNaN(scheduledUtc.getTime())) {
    return NextResponse.json({ error: "invalid date/time" }, { status: 400 });
  }

  const admin = supabaseServer();

  // ── resolve the patient phone ──
  let e164 = (body.e164 ?? "").trim();
  if (!e164 && body.original_call_id) {
    const { data: call } = await admin
      .from("calls")
      .select("to_e164, from_e164, direction")
      .eq("id", body.original_call_id)
      .maybeSingle();
    const c = call as { to_e164: string | null; from_e164: string | null; direction: string | null } | null;
    if (c) {
      // Outbound: the patient is the callee; inbound: the caller.
      e164 = (c.direction === "in" ? c.from_e164 : c.to_e164) ?? "";
    }
  }
  if (!e164) {
    return NextResponse.json({ error: "could not resolve patient phone (e164 or original_call_id)" }, { status: 400 });
  }

  // ── stamp the lead(s) ──  RAPPEL + rappel_rdv = a scheduled AI callback.
  const { data: updated, error } = await admin
    .from("leads_rdv")
    .update({ qualification: "RAPPEL", rappel_rdv: scheduledUtc.toISOString() })
    .eq("numero_telephone", e164)
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const matched = (updated ?? []).length;
  if (matched === 0) {
    // No lead row for this phone — report it so the agent can fall back to a
    // human callback task instead of silently dropping the request.
    return NextResponse.json({ ok: false, matched: 0, scheduled_for: scheduledUtc.toISOString() });
  }

  return NextResponse.json({
    ok: true,
    matched,
    scheduled_for: scheduledUtc.toISOString(),
    clamped: reqMin < MIN_MIN || reqMin > MAX_MIN,
  });
}
