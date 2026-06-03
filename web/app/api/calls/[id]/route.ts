import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }

  const orgId = await requestOrgId(request);
  const admin = supabaseServer();

  const { data: call, error } = await admin
    .from("calls")
    .select(
      "id, org_id, direction, state, from_e164, to_e164, room_id, started_at, answered_at, ended_at, duration_secs, recording_url, transcript_url, disposition, metadata, agent_handle_id, contact_id, summary, summary_generated_at, agent_handles(id, display_name, kind), contacts(id, e164, display_name)",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // call_events inherit tenant via call_id; the calls row above is already
  // org-filtered, so any events for this id are guaranteed in-tenant.
  const { data: events, error: evErr } = await admin
    .from("call_events")
    .select("id, at, kind, by_user_id, payload")
    .eq("call_id", id)
    .order("at", { ascending: true });

  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 });
  }

  return NextResponse.json({ call, events: events ?? [] });
}
