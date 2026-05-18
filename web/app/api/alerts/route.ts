import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const ackedParam = url.searchParams.get("acked");
  const severity = url.searchParams.get("severity");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);

  const sb = supabaseServer();
  let q = sb
    .from("alerts")
    .select("id, org_id, rule_id, call_id, severity, message, payload, acked, acked_by, acked_at, created_at")
    .eq("org_id", ctx.org_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ackedParam === "true") q = q.eq("acked", true);
  else if (ackedParam === "false") q = q.eq("acked", false);
  if (severity) q = q.eq("severity", severity);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** Bulk ack — body: { ids: string[] } or { all_unacked: true }. */
export async function PATCH(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["super_admin", "admin", "manager", "supervisor"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { ids?: string[]; all_unacked?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sb = supabaseServer();
  const patch = {
    acked: true,
    acked_by: ctx.user_id,
    acked_at: new Date().toISOString(),
  };

  let q = sb.from("alerts").update(patch).eq("org_id", ctx.org_id);
  if (body.all_unacked) {
    q = q.eq("acked", false);
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    q = q.in("id", body.ids);
  } else {
    return NextResponse.json({ error: "no_target" }, { status: 400 });
  }
  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, acked: (data ?? []).length });
}
