import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.TOKEN_RATE_LIMIT_PER_MINUTE ?? 20);

type SupervisionMode = "listen" | "whisper" | "barge";
const VALID_MODES: SupervisionMode[] = ["listen", "whisper", "barge"];

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
  const rl = rateLimit(`supervision-token:${ip}`, RATE_LIMIT);
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

  let body: { mode?: string } = {};
  try {
    body = (await request.json()) as { mode?: string };
  } catch {
    /* ignore */
  }

  const requestedMode = (body.mode ?? "listen") as SupervisionMode;
  const mode: SupervisionMode = VALID_MODES.includes(requestedMode)
    ? requestedMode
    : "listen";

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
  const { data: call, error } = await admin
    .from("calls")
    .select("id, org_id, room_id, state")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!call.room_id) {
    return NextResponse.json({ error: "call_has_no_room" }, { status: 409 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json({ error: "LiveKit env vars missing" }, { status: 500 });
  }

  const identity = `supervisor-${user.id}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 * 15 });

  // v1: all supervision modes are listen-only at the transport level.
  // The `supervision_mode` attribute lets the worker route a whisper/barge
  // track separately later without re-minting a new token contract.
  at.addGrant({
    room: call.room_id,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    hidden: mode === "listen",
  });
  at.attributes = {
    supervision_mode: mode,
    call_id: call.id,
    org_id: call.org_id,
    role: "supervisor",
  };
  at.metadata = JSON.stringify({
    supervision_mode: mode,
    call_id: call.id,
    role: "supervisor",
  });

  const token = await at.toJwt();
  return NextResponse.json(
    {
      token,
      url,
      room: call.room_id,
      identity,
      mode,
    },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
