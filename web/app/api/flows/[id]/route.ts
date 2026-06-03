import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  const { data: flow, error: fErr } = await sb
    .from("flows")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!flow) return NextResponse.json({ error: "not found" }, { status: 404 });

  // flow_steps / flow_edges inherit org via flow_id (no org_id column);
  // the flows row above was already filtered by org so this is safe.
  const { data: steps, error: sErr } = await sb
    .from("flow_steps")
    .select("*")
    .eq("flow_id", id)
    .order("created_at", { ascending: true });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const { data: edges, error: eErr } = await sb
    .from("flow_edges")
    .select("*")
    .eq("flow_id", id)
    .order("position", { ascending: true });
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });

  return NextResponse.json({ ...flow, steps: steps ?? [], edges: edges ?? [] });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "description", "metadata", "start_step_id"]) {
    if (k in body) patch[k] = body[k];
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb
    .from("flows")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { error } = await sb
    .from("flows")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
