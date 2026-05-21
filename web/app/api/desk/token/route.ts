import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.TOKEN_RATE_LIMIT_PER_MINUTE ?? 20);

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

export async function GET(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }

  const ip = clientIp(request);
  const rl = rateLimit(`desk-token:${ip}`, RATE_LIMIT);
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

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Find the human agent_handle for this user. Same caveat as /api/desk/dial:
  // RLS on agent_handles has no policy today, so the user-scoped client sees
  // zero rows. Use the admin client and gate via user.id from the verified
  // session.
  const admin = supabaseServer();
  const { data: handle, error: handleErr } = await admin
    .from("agent_handles")
    .select("id, org_id, display_name")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (handleErr) {
    return NextResponse.json({ error: handleErr.message }, { status: 500 });
  }
  if (!handle) {
    return NextResponse.json({ error: "no_human_handle" }, { status: 404 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json({ error: "LiveKit env vars missing" }, { status: 500 });
  }

  // Derive room name from the human's agent_handle id so callers can be
  // routed deterministically by the queue dispatcher.
  const room = `desk-${handle.id}`;
  const identity = `human-${user.id}`;

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 * 15 });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  at.attributes = {
    agent_handle_id: handle.id,
    org_id: handle.org_id,
    kind: "human",
  };
  at.metadata = JSON.stringify({
    agent_handle_id: handle.id,
    org_id: handle.org_id,
    kind: "human",
  });

  const token = await at.toJwt();
  return NextResponse.json(
    {
      token,
      url,
      room,
      identity,
      agent_handle_id: handle.id,
      display_name: handle.display_name,
    },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
