import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadPolicy(id: string, orgId: string) {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("analysis_policies")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const row = await loadPolicy(id, ctx.org_id);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

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
  if (!["super_admin", "admin", "manager"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "description", "prompt", "output_schema", "scope", "scope_id", "enabled", "model"]) {
    if (k in body) patch[k] = body[k];
  }
  if (patch.scope && !["all", "campaign", "queue"].includes(patch.scope as string)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  if (patch.scope === "all") patch.scope_id = null;

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("analysis_policies")
    .update(patch)
    .eq("id", id)
    .eq("org_id", ctx.org_id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["super_admin", "admin", "manager"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseServer();
  const { error } = await sb
    .from("analysis_policies")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.org_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
