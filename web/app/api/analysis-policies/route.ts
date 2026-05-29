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
    .from("analysis_policies")
    .select("id, org_id, name, description, prompt, output_schema, scope, scope_id, enabled, model, created_at")
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
    description?: string;
    prompt?: string;
    output_schema?: unknown;
    scope?: string;
    scope_id?: string | null;
    enabled?: boolean;
    model?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const prompt = (body.prompt ?? "").trim();
  if (!name || !prompt) {
    return NextResponse.json({ error: "name_and_prompt_required" }, { status: 400 });
  }
  if (!body.output_schema || typeof body.output_schema !== "object") {
    return NextResponse.json({ error: "output_schema_required" }, { status: 400 });
  }

  const scope = (body.scope ?? "all").trim();
  if (!["all", "campaign", "queue"].includes(scope)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("analysis_policies")
    .insert({
      org_id: ctx.org_id,
      name,
      description: body.description ?? null,
      prompt,
      output_schema: body.output_schema,
      scope,
      scope_id: scope === "all" ? null : body.scope_id ?? null,
      enabled: body.enabled ?? true,
      model: body.model ?? "deepseek-v4-flash",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
