import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["super_admin", "admin", "manager", "supervisor"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { acked?: boolean } = { acked: true };
  try {
    body = await request.json();
  } catch {
    /* default to ack=true */
  }

  const ack = body.acked !== false;
  const patch = ack
    ? { acked: true, acked_by: ctx.user_id, acked_at: new Date().toISOString() }
    : { acked: false, acked_by: null, acked_at: null };

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("alerts")
    .update(patch)
    .eq("id", id)
    .eq("org_id", ctx.org_id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}
