import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();

  const { data: flow, error: fErr } = await sb
    .from("flows")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!flow) return NextResponse.json({ error: "not found" }, { status: 404 });

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
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { error } = await sb.from("flows").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
