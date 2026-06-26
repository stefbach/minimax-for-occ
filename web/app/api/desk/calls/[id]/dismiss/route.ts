import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/calls/[id]/dismiss
 *
 * Dismisses an inbound ringing call from the human's desk:
 * - Clears agent_handle_id so the AI can take over
 * - Sets state to "ended" so it drops out of EN COURS immediately
 *
 * Only the agent whose handle_id matches the call's agent_handle_id may dismiss.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
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

  const { error } = await admin
    .from("calls")
    .update({
      agent_handle_id: null,
      state: "ended",
      ended_at: nowIso,
      disposition: "declined_by_human",
    })
    .eq("id", params.id)
    .eq("agent_handle_id", handle.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
