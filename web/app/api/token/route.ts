import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.TOKEN_RATE_LIMIT_PER_MINUTE ?? 20);

function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches don't send Origin
  const host = req.headers.get("host");
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }

  // Optional shared bearer for non-browser callers.
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
          "x-ratelimit-remaining": "0",
        },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const room = searchParams.get("room") ?? `voice-${crypto.randomUUID()}`;
  const identity = searchParams.get("identity") ?? `user-${crypto.randomUUID()}`;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LiveKit env vars missing" },
      { status: 500 },
    );
  }

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 * 15 });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json(
    { token, url, room, identity },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
