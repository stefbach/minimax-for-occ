import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) return NextResponse.json([]);
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("script_versions")
    .select("id, version, note, created_at, created_by")
    .eq("script_id", id)
    .order("version", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    steps?: unknown;
    note?: string | null;
  } | null;
  if (!body || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "steps[] requis" }, { status: 400 });
  }

  const sb = supabaseServer();

  // Compute the next version number.
  const { data: last } = await sb
    .from("script_versions")
    .select("version")
    .eq("script_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (last?.version ?? 0) + 1;

  const session = await supabaseSession();
  const { data: userData } = await session.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { data, error } = await sb
    .from("script_versions")
    .insert({
      script_id: id,
      version: nextVersion,
      steps: body.steps,
      note: body.note ?? null,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
