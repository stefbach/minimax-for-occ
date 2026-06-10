import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { runDueWorkflows } from "@/lib/automations/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Email + WATI sends across up to 50 rows can take a while.
export const maxDuration = 300;

/**
 * GET /api/automations/cron
 *
 * Vercel cron (every 5 min, see vercel.json) — runs every active native
 * workflow whose every_minutes cadence is due. Same CRON_SECRET bearer
 * convention as the sync-twilio / sync-retell crons.
 */
export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ ok: false, error: "supabase_unavailable" }, { status: 200 });
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const results = await runDueWorkflows();
    return NextResponse.json({
      ok: true,
      ran: results.length,
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        matched: r.stats.matched,
        actions: r.stats.actions,
        skipped: r.stats.skipped,
        errors: r.stats.errors,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
