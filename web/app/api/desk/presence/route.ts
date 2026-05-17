import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["offline", "available", "busy", "away"]);

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const status = body.status;
  if (!status || !ALLOWED.has(status)) {
    return NextResponse.json(
      { error: "status must be one of offline|available|busy|away" },
      { status: 400 },
    );
  }

  // Look up an org_id via the user's human agent_handle, falling back to
  // their first membership.
  const admin = supabaseServer();
  const { data: handle } = await admin
    .from("agent_handles")
    .select("org_id")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  let orgId: string | null = handle?.org_id ?? null;
  if (!orgId) {
    const { data: membership } = await admin
      .from("memberships")
      .select("org_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    orgId = membership?.org_id ?? null;
  }

  if (!orgId) {
    return NextResponse.json({ error: "no_org" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("human_presence")
    .upsert(
      {
        org_id: orgId,
        user_id: user.id,
        status,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "org_id,user_id" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function GET() {
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasSupabase()) return NextResponse.json(null);
  const admin = supabaseServer();
  const { data } = await admin
    .from("human_presence")
    .select("status, last_seen, current_call_id, org_id")
    .eq("user_id", user.id)
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json(data ?? null);
}
