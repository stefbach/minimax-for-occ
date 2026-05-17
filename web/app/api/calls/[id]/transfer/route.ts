import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { patchRoomMetadata } from "@/lib/livekit-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.HANDOFF_RATE_LIMIT_PER_MINUTE ?? 20);

// Loose E.164 check: '+' followed by 8–15 digits.
const E164_RE = /^\+[1-9]\d{7,14}$/;

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
  const rl = rateLimit(`transfer:${ip}`, RATE_LIMIT);
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

  let body: { e164?: string; reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const e164 = (body.e164 ?? "").trim();
  const reason = body.reason?.toString().slice(0, 500) ?? null;
  if (!E164_RE.test(e164)) {
    return NextResponse.json({ error: "invalid_e164" }, { status: 400 });
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

  const admin = supabaseServer();

  const { data: call, error: callErr } = await admin
    .from("calls")
    .select("id, org_id, room_id, state, agent_handle_id")
    .eq("id", id)
    .maybeSingle();
  if (callErr) {
    return NextResponse.json({ error: callErr.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: membership } = await sb
    .from("memberships")
    .select("role")
    .eq("org_id", call.org_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const requestedAt = new Date().toISOString();
  let metadataPushed = false;
  if (call.room_id) {
    metadataPushed = await patchRoomMetadata(call.room_id, {
      transfer_to_e164: e164,
      requested_at: requestedAt,
      requested_by: user.id,
    });
  }

  // TODO: the Python worker / a dedicated webhook needs to perform the
  // actual SIP REFER (or Twilio TwiML <Dial>) to bridge this call to the
  // external number. v1: we only log the intent.
  await admin.from("call_events").insert({
    call_id: call.id,
    kind: "transfer_pstn_requested",
    by_user_id: user.id,
    payload: {
      to_e164: e164,
      reason,
      metadata_pushed: metadataPushed,
      todo: "worker_must_perform_sip_transfer",
    },
  });

  return NextResponse.json(
    {
      ok: true,
      call_id: call.id,
      to_e164: e164,
      metadata_pushed: metadataPushed,
    },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
