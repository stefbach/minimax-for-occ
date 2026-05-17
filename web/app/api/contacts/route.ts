import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

function orgFrom(req: Request): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("org_id") ?? DEFAULT_ORG;
}

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contacts")
    .select("*")
    .eq("org_id", orgFrom(req))
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const body = (await req.json()) as {
    org_id?: string;
    e164: string;
    display_name?: string;
    email?: string;
    tags?: string[];
    notes?: string;
  };
  if (!body.e164) return NextResponse.json({ error: "e164 required" }, { status: 400 });
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contacts")
    .upsert(
      {
        org_id: body.org_id ?? DEFAULT_ORG,
        e164: body.e164,
        display_name: body.display_name ?? null,
        email: body.email ?? null,
        tags: body.tags ?? [],
        notes: body.notes ?? null,
      },
      { onConflict: "org_id,e164" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("contacts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
