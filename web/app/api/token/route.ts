import { NextResponse } from "next/server";
import { AccessToken, RoomConfiguration, RoomAgentDispatch } from "livekit-server-sdk";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.TOKEN_RATE_LIMIT_PER_MINUTE ?? 20);

// Wati 16/06 — séparation prod vs test sur LiveKit Cloud Agents.
//
// Deux LK Cloud Agents tournent le même code (auto-déployés sur push main) :
//   • "axon-voice-agent"      → CA_PFUfvaBhC8Wk    (prod, intouchable)
//   • "axon-voice-agent-test" → 2e agent dédié aux Charlotte-teste/etc
//
// Le routage ici décide où LiveKit envoie le dispatch en se basant sur le
// nom de l'agent OCC qui a été chargé. Tout agent dont le nom contient
// "teste" tape sur l'agent test. Les autres (Charlotte, Isabelle, Victoria
// prod) tapent sur la prod. Les env vars LIVEKIT_AGENT_NAME et
// LIVEKIT_AGENT_NAME_TEST permettent d'override si on veut renommer un jour.
const PROD_AGENT_NAME = process.env.LIVEKIT_AGENT_NAME ?? "axon-voice-agent";
// Tant que LIVEKIT_AGENT_NAME_TEST n'est pas défini en env, le routage test
// est désactivé et tous les dispatches vont sur la prod (statu quo
// d'aujourd'hui). Wati activera la séparation en ajoutant
// LIVEKIT_AGENT_NAME_TEST=axon-voice-agent-test sur Vercel quand son nouvel
// agent LK Cloud sera prêt.
const TEST_AGENT_NAME = process.env.LIVEKIT_AGENT_NAME_TEST ?? null;

async function resolveAgentName(agentId: string | null): Promise<string> {
  if (!TEST_AGENT_NAME) return PROD_AGENT_NAME;
  if (!agentId || !hasSupabase()) return PROD_AGENT_NAME;
  try {
    const sb = supabaseServer();
    const { data } = await sb
      .from("agents")
      .select("name")
      .eq("id", agentId)
      .maybeSingle();
    const name = (data?.name ?? "").toLowerCase();
    if (name.includes("teste") || name.includes("test")) return TEST_AGENT_NAME;
    return PROD_AGENT_NAME;
  } catch {
    return PROD_AGENT_NAME;
  }
}

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
  // Simulation: run a specific Script (by id) through the agent — including
  // multi-agent handoffs — without creating a campaign.
  const scriptId = searchParams.get("script_id");
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
  if (scriptId) {
    attrs.script_id = scriptId;
    meta.script_id = scriptId;
  }
  if (simulationVars) {
    // Stringify because participant attributes are flat string→string maps.
    attrs.simulation_vars = JSON.stringify(simulationVars);
    meta.simulation_vars = simulationVars;
  }
  if (Object.keys(attrs).length > 0) at.attributes = attrs;
  if (Object.keys(meta).length > 0) at.metadata = JSON.stringify(meta);

  // Explicitly dispatch the agent into this room. Sans dispatch explicite,
  // aucun agent ne rejoint la room et la simulation echoue silencieusement
  // (browser connecte, agent absent, disconnect timeout).
  // Routage prod vs test : voir resolveAgentName plus haut.
  const agentName = await resolveAgentName(agentId);
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
