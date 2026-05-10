import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { rateLimit, clientIp } from "@/lib/rate-limit";

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

  const expected = process.env.APP_SHARED_TOKEN;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const ip = clientIp(request);
  const rl = rateLimit(`token:${ip}`, RATE_LIMIT);
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

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const room = searchParams.get("room") ?? `voice-${crypto.randomUUID()}`;
  const identity = searchParams.get("identity") ?? `user-${crypto.randomUUID()}`;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json({ error: "LiveKit env vars missing" }, { status: 500 });
  }

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 * 15 });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  // Embed the agent_id in the participant attributes so the worker can read it
  // from `participant.attributes` when the user joins the room.
  if (agentId) {
    at.attributes = { agent_id: agentId };
    at.metadata = JSON.stringify({ agent_id: agentId });
  }

  const token = await at.toJwt();
  return NextResponse.json(
    { token, url, room, identity, agent_id: agentId ?? null },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
