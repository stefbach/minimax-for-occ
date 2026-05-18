import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("alert_rules")
    .select("id, org_id, name, policy_id, condition, severity, enabled, created_at")
    .eq("org_id", ctx.org_id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["super_admin", "admin", "manager"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: {
    name?: string;
    policy_id?: string | null;
    condition?: unknown;
    severity?: string;
    enabled?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!body.condition || typeof body.condition !== "object") {
    return NextResponse.json({ error: "condition_required" }, { status: 400 });
  }
  const severity = (body.severity ?? "info").trim();
  if (!["info", "warn", "critical"].includes(severity)) {
    return NextResponse.json({ error: "invalid_severity" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("alert_rules")
    .insert({
      org_id: ctx.org_id,
      name,
      policy_id: body.policy_id ?? null,
      condition: body.condition,
      severity,
      enabled: body.enabled ?? true,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
