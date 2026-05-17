import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("queues")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const orgId = await requestOrgId(req);
  const body = (await req.json()) as {
    name: string;
    description?: string;
    strategy?: "longest_idle" | "round_robin" | "broadcast";
    max_wait_secs?: number;
    fallback_voicemail?: boolean;
  };
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("queues")
    .insert({
      org_id: orgId,
      name: body.name,
      description: body.description ?? null,
      strategy: body.strategy ?? "longest_idle",
      max_wait_secs: body.max_wait_secs ?? 600,
      fallback_voicemail: body.fallback_voicemail ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
