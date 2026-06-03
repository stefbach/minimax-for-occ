import { NextResponse } from "next/server";
import { AccessToken, RoomConfiguration, RoomAgentDispatch } from "livekit-server-sdk";
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

  // Simulation mode: caller can inline a JSON map of template variables
  // (e.g. {"firstname":"Sarah","bmi":42}) that the worker should substitute
  // into the agent's system prompt + greeting in place of {{placeholders}}.
  // Used by the "Test in simulation" UI to drive an agent through realistic
  // patient data without creating a campaign + target row.
  const rawVars = searchParams.get("vars");
  let simulationVars: Record<string, unknown> | null = null;
  if (rawVars) {
    try {
      const parsed = JSON.parse(rawVars);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        simulationVars = parsed as Record<string, unknown>;
      }
    } catch {
      return NextResponse.json({ error: "vars must be valid JSON" }, { status: 400 });
    }
  }

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
  // Embed the agent_id (and simulation vars, if any) in the participant
  // attributes so the worker can read them from `participant.attributes`
  // when the user joins the room.
  const attrs: Record<string, string> = {};
  const meta: Record<string, unknown> = {};
  if (agentId) {
    attrs.agent_id = agentId;
    meta.agent_id = agentId;
  }
  if (simulationVars) {
    // Stringify because participant attributes are flat string→string maps.
    attrs.simulation_vars = JSON.stringify(simulationVars);
    meta.simulation_vars = simulationVars;
  }
  if (Object.keys(attrs).length > 0) at.attributes = attrs;
  if (Object.keys(meta).length > 0) at.metadata = JSON.stringify(meta);

  // Explicitly dispatch the agent into this room. The worker registers with
  // agent_name "minimax-voice-agent" (needed for SIP dispatch), which DISABLES
  // automatic dispatch — so frontend voice rooms must request the agent here,
  // otherwise no agent ever joins and the session can't start.
  const agentName = process.env.LIVEKIT_AGENT_NAME ?? "minimax-voice-agent";
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName,
        metadata: Object.keys(meta).length > 0 ? JSON.stringify(meta) : "",
      }),
    ],
  });

  const token = await at.toJwt();
  return NextResponse.json(
    { token, url, room, identity, agent_id: agentId ?? null },
    { headers: { "x-ratelimit-remaining": rl.remaining.toString() } },
  );
}
