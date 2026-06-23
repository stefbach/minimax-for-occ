import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/cleanup-stuck-calls   (Vercel cron, every minute)
 *
 * Janitor for "phantom" softphone call rows. A human softphone dial inserts a
 * `calls` row (state='ringing', channel='twilio_voice_sdk') BEFORE Twilio has a
 * call SID; the row is later reconciled — its real twilio_call_sid + state are
 * stamped either by the browser PATCH (/api/desk/sdk-call) or by the Twilio
 * sync. When a dial fires but never produces a real Twilio leg (e.g. a
 * duplicate auto-dial that was rejected because a call was already active),
 * the row is never reconciled and sits stuck in "ringing" forever, polluting
 * the desk's "EN COURS" list. That's what an agent saw as a call "placing
 * itself".
 *
 * This sweep flips such rows to 'failed' so they drop out of the live views.
 *
 * SAFETY — why this can never cut a real call:
 *  - It only edits a bookkeeping row. The actual audio path is Twilio Device
 *    (WebRTC) ↔ Twilio ↔ PSTN; nothing here can hang up a live Twilio call.
 *  - It is scoped to channel='twilio_voice_sdk' only, so IA/campaign calls and
 *    inbound LiveKit room calls are never touched.
 *  - A row is a candidate ONLY when it has no twilio_call_sid AND no
 *    twilio_last_status AND no answered_at — i.e. nothing ever observed it on
 *    Twilio. A real call gets at least one of those the moment it connects (the
 *    browser stamps answered_at on 'accept'; the sync/webhook stamp the SID and
 *    last_status). A real, still-ringing call is left alone until it crosses
 *    the age threshold AND is still completely unobserved.
 *  - Race guard: the UPDATE re-checks `twilio_call_sid IS NULL` at write time,
 *    so if the sync stamps a real SID between the SELECT and the UPDATE (a
 *    window we have observed in production) the row no longer matches and is
 *    spared.
 *  - Even a hypothetical false positive self-heals: the row stays SID-less, so
 *    the Twilio sync can still match it to the real call later and correct it.
 *
 * Same CRON_SECRET bearer convention as the sync-twilio / automations crons.
 */

// Rows older than this with zero Twilio evidence are considered phantoms.
const STUCK_AFTER_MS = 60_000; // 1 minute

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ ok: false, error: "supabase_unavailable" }, { status: 200 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

  // Candidates: human-softphone rows still shown as live, with no trace of ever
  // having reached Twilio, older than the threshold.
  const { data: candidates, error: selErr } = await admin
    .from("calls")
    .select("id, metadata")
    .in("state", ["ringing", "in_progress"])
    .eq("metadata->>channel", "twilio_voice_sdk")
    .is("metadata->>twilio_call_sid", null)
    .is("metadata->>twilio_last_status", null)
    .is("answered_at", null)
    .lt("started_at", cutoff)
    .limit(100);

  if (selErr) {
    log.error(`cleanup-stuck-calls select failed: ${selErr.message}`);
    return NextResponse.json({ ok: false, error: selErr.message }, { status: 200 });
  }

  const nowIso = new Date().toISOString();
  const cleaned: string[] = [];

  for (const row of candidates ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // Re-assert the phantom predicate at write time. If the Twilio sync stamped
    // a real SID (or the browser stamped answered_at) since the SELECT, these
    // filters won't match and we leave the now-real call untouched.
    const { data: updated, error: upErr } = await admin
      .from("calls")
      .update({
        state: "failed",
        ended_at: nowIso,
        disposition: "phantom_autodial",
        metadata: {
          ...meta,
          auto_expired_at: nowIso,
          auto_expired_reason:
            "stuck twilio_voice_sdk row: no twilio_call_sid / twilio_last_status / answered_at past 1min — never reached Twilio",
        },
      })
      .eq("id", row.id)
      .in("state", ["ringing", "in_progress"])
      .is("metadata->>twilio_call_sid", null)
      .is("metadata->>twilio_last_status", null)
      .is("answered_at", null)
      .select("id")
      .maybeSingle();
    if (upErr) {
      log.error(`cleanup-stuck-calls update failed for ${row.id}: ${upErr.message}`);
      continue;
    }
    if (updated?.id) cleaned.push(updated.id);
  }

  if (cleaned.length > 0) {
    log.info(`cleanup-stuck-calls expired ${cleaned.length} phantom call row(s)`);
  }

  return NextResponse.json({ ok: true, expired: cleaned.length, ids: cleaned });
}
