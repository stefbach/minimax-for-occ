import { NextResponse } from "next/server";
import { SipClient, AgentDispatchClient } from "livekit-server-sdk";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer } from "@/lib/supabase";
import { NoPhoneNumberError, pickFromNumber } from "@/lib/geo-routing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// LiveKit createSipParticipant with waitUntilAnswered=true blocks until the
// destination picks up or the ringing timeout fires (we set it to 30s). The
// Vercel function needs enough headroom to outlast it, hence 45s.
export const maxDuration = 45;

const RATE_LIMIT = Number(process.env.OUTBOUND_CALL_RATE_LIMIT_PER_MINUTE ?? 20);

/**
 * POST /api/outbound-call
 *
 * Body: {
 *   agent_id:   string,    // AI agent (agents.id) that should drive the call
 *   to_e164:    string,    // destination (+E.164)
 *   firstname?: string,    // template var for greeting / system prompt
 *   lastname?:  string,
 *   script_id?: string,    // optional Script to follow (multi-agent handoff
 *                          //   chain is resolved by the worker from the script)
 * }
 *
 * "Make outbound call" shortcut à la Retell — appelle UN numéro tout de suite
 * via UN agent IA sans créer de campagne ni target row. La PSTN leg est
 * amenée dans une room dédiée (`out-<call_id>`) via LiveKit SIP outbound
 * (Twilio trunk), et le worker `axon-voice-agent` est dispatché dans la
 * même room via AgentDispatchClient — son metadata embarque
 * {agent_id, script_id, simulation_vars: {firstname, lastname}} pour que
 * le worker charge le bon agent et substitue les template vars.
 *
 * Required env (path 1 de /api/desk/dial) :
 *   LIVEKIT_URL (or NEXT_PUBLIC_LIVEKIT_URL)
 *   LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 *   LIVEKIT_SIP_OUTBOUND_TRUNK_ID
 *
 * TODO Twilio REST fallback : pas implémenté ici. Avec path 2 de
 *   /api/desk/dial la PSTN leg atterrit dans `tel-*` et le dispatch rule
 *   choisit l'agent (typiquement l'IA par défaut), donc on perd la
 *   capacité de cibler un agent_id précis. Si LIVEKIT_SIP_OUTBOUND_TRUNK_ID
 *   n'est pas configuré on renvoie 500.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agent_id?: string;
    to_e164?: string;
    firstname?: string;
    lastname?: string;
    script_id?: string;
  };

  const agentId = (body.agent_id ?? "").trim();
  const to = (body.to_e164 ?? "").trim();
  const firstname = (body.firstname ?? "").trim();
  const lastname = (body.lastname ?? "").trim();
  const scriptId = (body.script_id ?? "").trim();

  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }
  if (!to || !/^\+\d{6,15}$/.test(to)) {
    return NextResponse.json(
      { error: "to_e164 must be E.164 (e.g. +33756123456)" },
      { status: 400 },
    );
  }

  // Authenticate the caller. We use the user-scoped session client to derive
  // their memberships, then the admin client for the actual DB writes — same
  // pattern as /api/desk/dial (agent_handles / calls have no per-row RLS).
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Per-user rate limit (each call costs a Twilio originate).
  const rl = rateLimit(`outbound-call:user:${user.id}`, RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      },
    );
  }

  const admin = supabaseServer();

  // Anchor on the agent row's org_id (not the cookie) so a stale org cookie
  // can't trigger a call billed to another tenant's numbers.
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, org_id, name")
    .eq("id", agentId)
    .maybeSingle();
  if (agentErr || !agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  // Membership check : caller must belong to the agent's org (or super_admin).
  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id);
  const rows = (memberships ?? []) as Array<{ org_id: string; role: string }>;
  const isSuper = rows.some((m) => m.role === "super_admin");
  if (!isSuper && !rows.some((m) => m.org_id === agent.org_id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Find the AI agent_handle (calls.agent_handle_id FK). Cloned/duplicated
  // agents (eg "Charlotte - teste") can land in DB without a matching handle
  // — the /api/agents POST creates one, but other code paths bypass that.
  // Auto-heal here so "Make outbound call" works without a manual SQL fix.
  let handle: { id: string; org_id: string; display_name: string };
  {
    const { data: existing, error: handleErr } = await admin
      .from("agent_handles")
      .select("id, org_id, display_name")
      .eq("kind", "ai")
      .eq("ai_agent_id", agent.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (handleErr) {
      return NextResponse.json({ error: handleErr.message }, { status: 500 });
    }
    if (existing) {
      handle = existing;
    } else {
      const { data: created, error: createErr } = await admin
        .from("agent_handles")
        .insert({
          org_id: agent.org_id,
          kind: "ai",
          ai_agent_id: agent.id,
          display_name: agent.name,
          active: true,
        })
        .select("id, org_id, display_name")
        .single();
      if (createErr || !created) {
        return NextResponse.json(
          {
            error:
              "no active AI agent_handle for this agent and auto-heal failed: " +
              (createErr?.message ?? "unknown"),
          },
          { status: 500 },
        );
      }
      handle = created;
    }
  }

  // DNC enforcement (TCPA), same as /api/desk/dial.
  {
    const { data: dnc } = await admin
      .from("dnc_lists")
      .select("id, reason")
      .eq("org_id", agent.org_id)
      .eq("e164", to)
      .maybeSingle();
    if (dnc) {
      return NextResponse.json(
        {
          error:
            "Ce numéro figure sur la liste DNC (Do Not Call) de votre organisation. " +
            "Appel bloqué pour conformité TCPA." +
            (dnc.reason ? ` Motif : ${dnc.reason}` : ""),
          code: "dnc_blocked",
        },
        { status: 403 },
      );
    }
  }

  // Pick a from_number via geo-routing.
  let from: string;
  try {
    const picked = await pickFromNumber(admin, agent.org_id, to);
    from = picked.e164;
  } catch (err) {
    if (err instanceof NoPhoneNumberError) {
      return NextResponse.json(
        {
          error:
            "Aucun numéro de téléphone provisionné pour cette organisation. " +
            "Achetez un numéro dans la page Numéros avant d'appeler.",
        },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : "Erreur de routage géo";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Auto-upsert the contact so the call attaches to a CRM record.
  let contactId: string | null = null;
  {
    const contactPayload: Record<string, unknown> = { org_id: agent.org_id, e164: to };
    if (firstname || lastname) {
      contactPayload.display_name = [firstname, lastname].filter(Boolean).join(" ").trim();
    }
    const { data: contact } = await admin
      .from("contacts")
      .upsert(contactPayload, { onConflict: "org_id,e164", ignoreDuplicates: false })
      .select("id")
      .single();
    contactId = contact?.id ?? null;
  }

  // Simulation vars — template variables substituted into greeting /
  // system prompt by the worker (e.g. "Bonjour {{firstname}}").
  const simulationVars: Record<string, string> = {};
  if (firstname) simulationVars.firstname = firstname;
  if (lastname) simulationVars.lastname = lastname;

  const callMetadata: Record<string, unknown> = {
    agent_id: agent.id,
    channel: "outbound_shortcut",
  };
  if (scriptId) callMetadata.script_id = scriptId;
  if (Object.keys(simulationVars).length > 0) callMetadata.simulation_vars = simulationVars;

  // Insert the call row first so we have an id for the room name.
  const tempRoom = `out-pending-${crypto.randomUUID()}`;
  const { data: call, error: callErr } = await admin
    .from("calls")
    .insert({
      org_id: agent.org_id,
      direction: "out",
      state: "ringing",
      from_e164: from,
      to_e164: to,
      agent_handle_id: handle.id,
      contact_id: contactId,
      room_id: tempRoom,
      metadata: callMetadata,
    })
    .select()
    .single();
  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });

  const roomName = `out-${call.id}`;
  await admin.from("calls").update({ room_id: roomName }).eq("id", call.id);

  // ─── LiveKit outbound SIP ──────────────────────────────────────────────
  const lkOutboundTrunkId = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID;
  const lkUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const lkApiKey = process.env.LIVEKIT_API_KEY;
  const lkApiSecret = process.env.LIVEKIT_API_SECRET;

  if (!lkOutboundTrunkId || !lkUrl || !lkApiKey || !lkApiSecret) {
    await admin
      .from("calls")
      .update({ state: "failed", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    return NextResponse.json(
      {
        error:
          "Appel sortant IA indisponible : LIVEKIT_SIP_OUTBOUND_TRUNK_ID, " +
          "LIVEKIT_URL/API_KEY/API_SECRET doivent être configurés. " +
          "Le fallback Twilio REST ne permet pas de cibler un agent IA précis.",
      },
      { status: 500 },
    );
  }

  const httpUrl = lkUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  // Wati 16/06 — meme routage prod vs test que /api/token : agents dont le
  // nom contient "teste" tapent sur axon-voice-agent-test (cluster TEST
  // CA_PbChboVCvPJC, ou ELEVEN_API_KEY est configuree), les autres sur
  // axon-voice-agent (PROD CA_PFUfvaBhC8Wk). Tant que
  // LIVEKIT_AGENT_NAME_TEST n'est pas defini, statu quo (tout vers prod).
  const PROD_AGENT = process.env.LIVEKIT_AGENT_NAME ?? "axon-voice-agent";
  const TEST_AGENT = process.env.LIVEKIT_AGENT_NAME_TEST ?? null;
  const agentName = (() => {
    if (!TEST_AGENT) return PROD_AGENT;
    const n = (agent.name ?? "").toLowerCase();
    // Match STRICT sur "teste" (Wati 18/06) : voir /api/token. Evite qu'un
    // nom prod contenant "test" parte par erreur sur le cluster test.
    return n.includes("teste") ? TEST_AGENT : PROD_AGENT;
  })();
  const dispatchMetadata = JSON.stringify({
    agent_id: agent.id,
    call_id: call.id,
    direction: "out",
    ...(scriptId ? { script_id: scriptId } : {}),
    ...(Object.keys(simulationVars).length > 0 ? { simulation_vars: simulationVars } : {}),
  });

  // 1) Dispatch axon-voice-agent into the room first. createDispatch
  //    auto-creates the room if it doesn't exist (LiveKit Cloud behaviour);
  //    the worker reads `dispatch.metadata` and loads agent_id.
  try {
    const dispatcher = new AgentDispatchClient(httpUrl, lkApiKey, lkApiSecret);
    await dispatcher.createDispatch(roomName, agentName, { metadata: dispatchMetadata });
  } catch (err) {
    await admin
      .from("calls")
      .update({ state: "failed", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[outbound-call] AgentDispatchClient.createDispatch failed:", msg);
    return NextResponse.json(
      { error: `LiveKit dispatch: ${msg}`, via: "livekit" },
      { status: 502 },
    );
  }

  // 2) Bring the PSTN leg in. fromNumber on the SIP options ensures the
  //    geo-picked caller-ID is honoured (cf /api/desk/dial comments).
  const sip = new SipClient(httpUrl, lkApiKey, lkApiSecret);
  try {
    const sipOptions = {
      participantIdentity: `pstn-${call.id}`,
      participantName: to,
      participantAttributes: {
        "axon.call_id": call.id,
        "axon.direction": "out",
        "axon.agent_handle_id": handle.id,
        "axon.agent_id": agent.id,
        "axon.from_e164": from,
        ...(scriptId ? { "axon.script_id": scriptId } : {}),
        ...(Object.keys(simulationVars).length > 0
          ? { "axon.simulation_vars": JSON.stringify(simulationVars) }
          : {}),
      },
      waitUntilAnswered: true,
      ringingTimeout: 30,
      fromNumber: from,
    };
    const participant = await sip.createSipParticipant(
      lkOutboundTrunkId,
      to,
      roomName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sipOptions as any,
    );
    await admin
      .from("calls")
      .update({
        metadata: {
          ...callMetadata,
          livekit_participant_sid: participant.participantId ?? null,
        },
      })
      .eq("id", call.id);
    return NextResponse.json(
      {
        ok: true,
        call_id: call.id,
        via: "livekit",
        room: roomName,
        contact_id: contactId,
      },
      { status: 201 },
    );
  } catch (err) {
    await admin
      .from("calls")
      .update({ state: "failed", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[outbound-call] LiveKit createSipParticipant failed:", msg);
    return NextResponse.json(
      { error: `LiveKit SIP: ${msg}`, via: "livekit" },
      { status: 502 },
    );
  }
}
