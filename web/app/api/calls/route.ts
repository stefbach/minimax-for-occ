import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

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

  const { searchParams } = new URL(request.url);
  const orgId = await requestOrgId(request);
  const stateParam = searchParams.get("state");
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 250);

  const states = stateParam
    ? stateParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => VALID_STATES.has(s))
    : [];

  const admin = supabaseServer();

  let q = admin
    .from("calls")
    .select(
      "id, org_id, direction, state, from_e164, to_e164, room_id, started_at, answered_at, ended_at, duration_secs, disposition, recording_url, transcript_url, agent_handle_id, contact_id, agent_handles(id, display_name, kind), contacts(id, e164, display_name)",
    )
    .eq("org_id", orgId)
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
