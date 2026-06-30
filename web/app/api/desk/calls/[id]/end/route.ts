import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/calls/[id]/end
 *
 * Called by the human agent when they explicitly click "Hang up" on a
 * LiveKit inbound call. Marks the call as ended in Supabase so it drops
 * out of the ringing/in_progress query and the banner/ringtone stop.
 *
 * Only updates if the call is still ringing or in_progress (idempotent
 * when the Python worker already ended it first).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();

  const { data: handle } = await admin
    .from("agent_handles")
    .select("id")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!handle) {
    return NextResponse.json({ error: "no handle" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();

  await admin
    .from("calls")
    .update({
      state: "ended",
      ended_at: nowIso,
      disposition: "answered",
    })
    .eq("id", id)
    .eq("agent_handle_id", handle.id)
    .in("state", ["ringing", "in_progress"]);

  return NextResponse.json({ ok: true });
}
