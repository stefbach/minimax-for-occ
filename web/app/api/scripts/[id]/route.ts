import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const sb = supabaseServer();

  const { data: script, error } = await sb
    .from("scripts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: latest } = await sb
    .from("script_versions")
    .select("id, version, steps, note, created_at, created_by")
    .eq("script_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ ...script, latest_version: latest ?? null });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "mission", "description"] as const) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "rien à mettre à jour" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("scripts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { error } = await sb.from("scripts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
