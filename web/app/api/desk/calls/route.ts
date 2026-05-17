import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES = new Set([
  "queued",
  "ringing",
  "ivr",
  "in_progress",
  "wrap_up",
  "ended",
  "failed",
]);

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json([]);

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();
  // Resolve the human agent_handle id for this user.
  const { data: handle } = await admin
    .from("agent_handles")
    .select("id, org_id")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!handle) {
    return NextResponse.json([]);
  }

  const { searchParams } = new URL(request.url);
  const stateParam = searchParams.get("state");
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);

  const states = stateParam
    ? stateParam.split(",").map((s) => s.trim()).filter((s) => VALID_STATES.has(s))
    : [];

  let q = admin
    .from("calls")
    .select(
      "id, direction, state, from_e164, to_e164, room_id, started_at, answered_at, ended_at, duration_secs, contact_id, queue_id, contacts(id, e164, display_name)",
    )
    .eq("agent_handle_id", handle.id)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (states.length > 0) {
    q = q.in("state", states);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
