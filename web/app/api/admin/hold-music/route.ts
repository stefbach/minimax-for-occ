import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ hold_music_url: null });
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("organizations")
    .select("id, name, hold_music_url")
    .eq("id", ctx.org_id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["super_admin", "admin", "manager"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { hold_music_url?: string | null } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const url = (body.hold_music_url ?? "").trim();
  // Validate URL if non-empty. Empty string → reset to null (use Twilio default).
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad scheme");
    } catch {
      return NextResponse.json({ error: "invalid_url" }, { status: 400 });
    }
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("organizations")
    .update({ hold_music_url: url || null })
    .eq("id", ctx.org_id)
    .select("id, name, hold_music_url")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
