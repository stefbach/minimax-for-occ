import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { syncRetellCalls } from "@/lib/retell-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pull Retell call history into Axon's `calls` table.
//   POST  → manual trigger for the current session's org (dashboard-gated).
//   GET   → config status, OR a Vercel-cron run when called with the CRON_SECRET
//           bearer token (syncs the org in RETELL_SYNC_ORG_ID).

function parseWindow(qs: URLSearchParams): { sinceMs: number; maxCalls: number } {
  const days = Math.min(90, Math.max(1, Number(qs.get("days") ?? 2)));
  const maxCalls = Math.min(50000, Math.max(100, Number(qs.get("max") ?? 5000)));
  return { sinceMs: Date.now() - days * 86400_000, maxCalls };
}

export async function POST(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  if (!process.env.RETELL_API_KEY) {
    return NextResponse.json({ error: "retell_not_configured" }, { status: 503 });
  }
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const { sinceMs, maxCalls } = parseWindow(new URL(request.url).searchParams);
  try {
    const result = await syncRetellCalls(orgId, { sinceMs, maxCalls });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  // Vercel cron path: authenticated by the shared secret, no user session.
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const orgId = process.env.RETELL_SYNC_ORG_ID;
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "RETELL_SYNC_ORG_ID not set" }, { status: 200 });
    }
    if (!process.env.RETELL_API_KEY) {
      return NextResponse.json({ ok: false, error: "retell_not_configured" }, { status: 200 });
    }
    const { sinceMs, maxCalls } = parseWindow(searchParams);
    try {
      const result = await syncRetellCalls(orgId, { sinceMs, maxCalls });
      return NextResponse.json({ ok: true, cron: true, ...result });
    } catch (e) {
      // 200 so Vercel doesn't hammer retries on a transient Retell hiccup.
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
    }
  }

  // Plain status probe.
  return NextResponse.json({
    ok: true,
    retell_configured: Boolean(process.env.RETELL_API_KEY),
    cron_configured: Boolean(cronSecret && process.env.RETELL_SYNC_ORG_ID),
  });
}
