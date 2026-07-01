import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { syncTwilioCalls, syncTwilioSms } from "@/lib/twilio-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Reconcile Twilio's call history into Axon's `calls`.
//   POST → manual trigger for the current session's org (dashboard-gated).
//   GET  → config status, OR a Vercel-cron run with the CRON_SECRET bearer
//          token (syncs the org in TWILIO_SYNC_ORG_ID / RETELL_SYNC_ORG_ID).

function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function parseWindow(qs: URLSearchParams): { sinceMs: number; maxCalls: number } {
  const days = Math.min(90, Math.max(1, Number(qs.get("days") ?? 2)));
  const maxCalls = Math.min(50000, Math.max(100, Number(qs.get("max") ?? 5000)));
  return { sinceMs: Date.now() - days * 86400_000, maxCalls };
}

export async function POST(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  if (!twilioConfigured()) return NextResponse.json({ error: "twilio_not_configured" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const { sinceMs, maxCalls } = parseWindow(new URL(request.url).searchParams);
  try {
    const result = await syncTwilioCalls(orgId, { sinceMs, maxCalls });
    // Reconcile SMS costs too (best-effort — never fail the call sync over it).
    let sms: Awaited<ReturnType<typeof syncTwilioSms>> | { error: string } | undefined;
    try { sms = await syncTwilioSms(orgId, { sinceMs }); }
    catch (e) { sms = { error: e instanceof Error ? e.message : String(e) }; }
    return NextResponse.json({ ok: true, ...result, sms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sync-twilio] POST failed org=${orgId}: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const orgId = process.env.TWILIO_SYNC_ORG_ID || process.env.RETELL_SYNC_ORG_ID;
    if (!orgId) return NextResponse.json({ ok: false, error: "TWILIO_SYNC_ORG_ID not set" }, { status: 200 });
    if (!twilioConfigured()) return NextResponse.json({ ok: false, error: "twilio_not_configured" }, { status: 200 });
    const { sinceMs, maxCalls } = parseWindow(searchParams);
    try {
      const result = await syncTwilioCalls(orgId, { sinceMs, maxCalls });
      let sms: Awaited<ReturnType<typeof syncTwilioSms>> | { error: string } | undefined;
      try { sms = await syncTwilioSms(orgId, { sinceMs }); }
      catch (e) { sms = { error: e instanceof Error ? e.message : String(e) }; }
      return NextResponse.json({ ok: true, cron: true, ...result, sms });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
    }
  }

  return NextResponse.json({
    ok: true,
    twilio_configured: twilioConfigured(),
    cron_configured: Boolean(cronSecret && (process.env.TWILIO_SYNC_ORG_ID || process.env.RETELL_SYNC_ORG_ID)),
  });
}
