import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UK_TZ = "Europe/London";
const MIN_HOUR = 8;
const MAX_HOUR = 21;

/**
 * PATCH /api/desk/ai-callbacks/update
 *   { e164, action: "reschedule", date: "YYYY-MM-DD", time: "HH:MM" }
 *   { e164, action: "cancel" }
 *
 * Reschedule: updates rappel_rdv to the new UK date/time (clamped to 08-21h).
 * Cancel: clears rappel_rdv and resets qualification to "PAS DE REPONSE" so the
 * lead re-enters normal campaign cadence.
 */
export async function PATCH(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    e164?: string;
    action?: "reschedule" | "cancel";
    date?: string;
    time?: string;
  } | null;

  if (!body?.e164 || !body.action) {
    return NextResponse.json({ error: "e164 and action required" }, { status: 400 });
  }

  await requestOrgId(req); // auth guard only — leads_rdv has no org_id
  const admin = supabaseServer();

  if (body.action === "cancel") {
    const { error, count } = await admin
      .from("leads_rdv" as never)
      .update({
        rappel_rdv: null,
        qualification: "PAS DE REPONSE",
        last_qualification_update: new Date().toISOString(),
      } as never)
      .eq("numero_telephone", body.e164);
    if (error) return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "cancel", matched: count });
  }

  // reschedule
  if (!body.date || !body.time) {
    return NextResponse.json({ error: "date and time required for reschedule" }, { status: 400 });
  }

  const scheduledFor = ukToUtc(body.date, body.time);
  if (!scheduledFor) {
    return NextResponse.json({ error: "invalid date or time" }, { status: 400 });
  }

  const { error, count } = await admin
    .from("leads_rdv" as never)
    .update({
      rappel_rdv: scheduledFor.toISOString(),
      qualification: "RAPPEL",
      last_qualification_update: new Date().toISOString(),
    } as never)
    .eq("numero_telephone", body.e164);
  if (error) return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 });

  return NextResponse.json({ ok: true, action: "reschedule", scheduled_for: scheduledFor.toISOString(), matched: count });
}

/**
 * Convert a UK wall-clock date+time string to a UTC Date.
 * Clamps to 08:00–21:00 UK. Returns null if the date is invalid.
 */
function ukToUtc(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr ?? "9", 10);
  let m = parseInt(mStr ?? "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // clamp
  if (h < MIN_HOUR) { h = MIN_HOUR; m = 0; }
  if (h > MAX_HOUR) { h = MAX_HOUR; m = 0; }

  // Build a wall-clock string and interpret it as Europe/London.
  // We find the UTC offset by formatting a reference date in UK timezone.
  const wallStr = `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  // Use Intl to get offset (handles DST automatically).
  const probe = new Date(`${wallStr}Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TZ, hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(probe);
  const probeH = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const probeM = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const offsetMin = (h * 60 + m) - (probeH * 60 + probeM);
  return new Date(probe.getTime() - offsetMin * 60000);
}
