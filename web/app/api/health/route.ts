/**
 * Health check endpoint.
 *
 * GET /api/health
 *
 * Returns a JSON snapshot of every external dependency the platform relies
 * on. Each check is a lightweight ping (no authenticated I/O, no DB writes)
 * so the endpoint is cheap enough to wire to Uptime Robot / Pingdom /
 * Vercel Monitoring.
 *
 * Response shape:
 *   {
 *     ok: boolean,
 *     version: "<git sha or 'dev'>",
 *     checks: { supabase, openai, twilio, livekit, n8n }   // "ok" | "fail" | "skipped"
 *   }
 *
 * Status:
 *   200 when every configured service responds.
 *   503 when at least one configured service fails. Services with missing
 *       env vars report "skipped" and do NOT trip the overall status — a
 *       fresh deploy without n8n shouldn't 503 the world.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = "ok" | "fail" | "skipped";
type Checks = {
  supabase: CheckResult;
  openai: CheckResult;
  twilio: CheckResult;
  livekit: CheckResult;
  n8n: CheckResult;
};

/** Resolve the running version: VERCEL_GIT_COMMIT_SHA, GIT_SHA, or "dev". */
function appVersion(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    "dev"
  );
}

/** Race a promise against a timeout — returns "fail" if it doesn't resolve in time. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

async function checkSupabase(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!url) return "skipped";
  // /auth/v1/health is anonymous and cheap — no auth headers needed.
  const res = await withTimeout(
    fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, { method: "GET" }),
    3_000,
  );
  return res && res.ok ? "ok" : "fail";
}

async function checkOpenai(): Promise<CheckResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "skipped";
  const res = await withTimeout(
    fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    }),
    3_000,
  );
  return res && res.ok ? "ok" : "fail";
}

async function checkTwilio(): Promise<CheckResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return "skipped";
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await withTimeout(
    fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { authorization: `Basic ${auth}` },
    }),
    3_000,
  );
  return res && res.ok ? "ok" : "fail";
}

async function checkLivekit(): Promise<CheckResult> {
  const url = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) return "skipped";
  // Convert wss:// -> https:// so fetch can reach the HTTP listener that
  // serves the LiveKit dashboard / OpenAPI endpoint.
  const httpUrl = url.replace(/^wss?:\/\//, "https://").replace(/\/+$/, "");
  const res = await withTimeout(fetch(httpUrl, { method: "GET" }), 3_000);
  // LiveKit returns 404 on the root with a body — that's still "alive".
  return res ? "ok" : "fail";
}

async function checkN8n(): Promise<CheckResult> {
  const base = process.env.N8N_BASE_URL;
  if (!base) return "skipped";
  const res = await withTimeout(
    fetch(`${base.replace(/\/+$/, "")}/healthz`, { method: "GET" }),
    3_000,
  );
  return res && res.ok ? "ok" : "fail";
}

export async function GET(): Promise<NextResponse> {
  const [supabase, openai, twilio, livekit, n8n] = await Promise.all([
    checkSupabase().catch(() => "fail" as CheckResult),
    checkOpenai().catch(() => "fail" as CheckResult),
    checkTwilio().catch(() => "fail" as CheckResult),
    checkLivekit().catch(() => "fail" as CheckResult),
    checkN8n().catch(() => "fail" as CheckResult),
  ]);

  const checks: Checks = { supabase, openai, twilio, livekit, n8n };
  // Overall OK iff no check is "fail" (skipped is acceptable).
  const ok = Object.values(checks).every((v) => v !== "fail");

  return NextResponse.json(
    { ok, version: appVersion(), checks },
    { status: ok ? 200 : 503 },
  );
}
