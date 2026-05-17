import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }

  let body: { kind?: string; payload?: unknown } = {};
  try {
    body = (await request.json()) as { kind?: string; payload?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const kind = (body.kind ?? "").trim();
  if (!kind) {
    return NextResponse.json({ error: "kind_required" }, { status: 400 });
  }
  const payload =
    body.payload && typeof body.payload === "object" ? body.payload : {};

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user?.id ?? null;

  const admin = supabaseServer();

  // Sanity-check the call exists.
  const { data: call, error: callErr } = await admin
    .from("calls")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (callErr) {
    return NextResponse.json({ error: callErr.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("call_events")
    .insert({
      call_id: id,
      kind,
      by_user_id: userId,
      payload,
    })
    .select("id, at, kind, by_user_id, payload")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
