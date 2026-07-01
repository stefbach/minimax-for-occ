import { NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/calls/[id]/end
 *
 * Called by the human agent when they explicitly click "Hang up" on a
 * LiveKit inbound call. Two things:
 *   1. Marks the call as ended in Supabase (state→ended, disposition→answered)
 *   2. Deletes the LiveKit room so the SIP bridge disconnects and the
 *      PSTN caller's phone actually hangs up.
 *
 * Only updates Supabase if the call is still ringing or in_progress (idempotent
 * when the Python worker already ended it first). Room deletion is best-effort.
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

  // Fetch the call to get its room_id before updating state.
  const { data: call } = await admin
    .from("calls")
    .select("id, room_id, state")
    .eq("id", id)
    .eq("agent_handle_id", handle.id)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (call && (call.state === "ringing" || call.state === "in_progress")) {
    await admin
      .from("calls")
      .update({
        state: "ended",
        ended_at: nowIso,
        disposition: "answered",
      })
      .eq("id", id)
      .eq("agent_handle_id", handle.id);
  }

  // Delete the LiveKit room so the SIP bridge disconnects and the PSTN
  // caller's phone actually hangs up. Best-effort — don't fail the
  // response if LiveKit env vars are missing or the room is already gone.
  if (call?.room_id) {
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (livekitUrl && apiKey && apiSecret) {
      const roomClient = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
      await roomClient.deleteRoom(call.room_id).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
