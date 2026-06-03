import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { patchRoomMetadata } from "@/lib/livekit-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.HANDOFF_RATE_LIMIT_PER_MINUTE ?? 20);

function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }
  const ip = clientIp(request);
  const rl = rateLimit(`handoff:${ip}`, RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString(),
        },
      },
    );
  }

  const { id } = await context.params;

  let body: { target_agent_handle_id?: string; reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const target = (body.target_agent_handle_id ?? "").trim();
  const reason = body.reason?.toString().slice(0, 500) ?? null;
  if (!target) {
    return NextResponse.json(
      { error: "target_agent_handle_id_required" },
      { status: 400 },
    );
  }

  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const orgId = await requestOrgId(request);
  const admin = supabaseServer();

  const { data: call, error: callErr } = await admin
    .from("calls")
    .select(
      "id, org_id, room_id, state, agent_handle_id, agent_handles(id, kind, display_name)",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (callErr) {
    return NextResponse.json({ error: callErr.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Verify the caller has a role on this org. Any membership = allowed for v1;
  // we deliberately don't lock this to supervisor/manager so agents can also
  // initiate handoffs from their softphone.
  const { data: membership } = await sb
    .from("memberships")
    .select("role")
    .eq("org_id", call.org_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Resolve target handle and make sure it's in the same org + active.
  const { data: targetHandle, error: thErr } = await admin
    .from("agent_handles")
    .select("id, org_id, kind, active, display_name, ai_agent_id, user_id")
    .eq("id", target)
    .eq("org_id", orgId)
    .maybeSingle();
  if (thErr) {
    return NextResponse.json({ error: thErr.message }, { status: 500 });
  }
  if (!targetHandle) {
    return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  }
  if (targetHandle.org_id !== call.org_id) {
    return NextResponse.json({ error: "cross_org_handoff_forbidden" }, { status: 403 });
  }
  if (!targetHandle.active) {
    return NextResponse.json({ error: "target_inactive" }, { status: 409 });
  }

  const fromKind =
    (call.agent_handles as unknown as { kind?: string } | null)?.kind ?? "ai";
  const toKind = targetHandle.kind;
  const requestedAt = new Date().toISOString();

  // Push metadata so the Python worker / human softphone can react in real time.
  // Best-effort: if the LiveKit room isn't reachable we still update the DB so
  // the worker can pick it up via Supabase realtime instead.
  let metadataPushed = false;
  if (call.room_id) {
    metadataPushed = await patchRoomMetadata(call.room_id, {
      handoff_to: targetHandle.id,
      handoff_to_kind: toKind,
      handoff_to_ai_agent_id: targetHandle.ai_agent_id ?? null,
      handoff_to_user_id: targetHandle.user_id ?? null,
      requested_at: requestedAt,
      requested_by: user.id,
    });
  }

  // Reassign the call to the new handle.
  const { error: updErr } = await admin
    .from("calls")
    .update({ agent_handle_id: targetHandle.id })
    .eq("id", call.id)
    .eq("org_id", orgId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const kind = `handoff_${fromKind}_to_${toKind}`;
  await admin.from("call_events").insert({
    call_id: call.id,
    kind,
    by_user_id: user.id,
    payload: {
      from: call.agent_handle_id,
      to: targetHandle.id,
      from_kind: fromKind,
      to_kind: toKind,
      reason,
      metadata_pushed: metadataPushed,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      call_id: call.id,
      new_agent_handle_id: targetHandle.id,
      metadata_pushed: metadataPushed,
    },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
