"""Axon LiveKit voice worker.

Loads per-session agent configuration from Supabase based on the
`agent_id` embedded in the room metadata / participant attributes by
the front-end's /api/token route. Falls back to env-driven defaults if
no agent_id is provided (lets you keep using the worker without the
platform UI).

Run locally:
    python agent.py dev

Deploy:
    lk agent deploy           # first deployment
    lk agent deploy           # subsequent deployments (rebuilds image)
    lk agent update           # secrets only, no rebuild
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import deepgram, minimax, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from agent_config import (
    AxonAgent,
    _agent_id_from_metadata,
    load_agent,
    rag_search,
    resolve_agent_id,
)
from db_writes import append_transcript_turn, trigger_post_call_pipeline
from flow_runtime import (
    FlowRuntime,
    call_id_from_metadata,
    flow_id_from_metadata,
    handoff_target_from_metadata,
)
from swarm import build_transfer_tool

load_dotenv()

logger = logging.getLogger("axon-voice-agent")
logger.setLevel(logging.INFO)


# ─── Observability: prefix every log line with [call_id=…] when known ─────
class CallIdAdapter(logging.LoggerAdapter):
    """LoggerAdapter that injects `[call_id=<id>]` into every log message.

    Built once per JobContext after we resolve the call_id from room metadata
    so downstream filters in Vercel/Fly/Datadog can group by call.
    """

    def process(self, msg, kwargs):  # type: ignore[override]
        cid = self.extra.get("call_id") if self.extra else None
        if cid:
            return f"[call_id={cid}] {msg}", kwargs
        return msg, kwargs


def _logger_for_call(call_id: Optional[str]) -> logging.LoggerAdapter:
    """Return a LoggerAdapter bound to a call_id (None → unprefixed)."""
    return CallIdAdapter(logger, {"call_id": call_id} if call_id else {})


# ─── LLM factory ──────────────────────────────────────────────────────────
def _llm_for(agent: Optional[AxonAgent]):
    """Build a LiveKit-Agents-compatible LLM from the agent's provider/model."""
    provider = (agent.llm_provider if agent else os.getenv("LLM_PROVIDER", "deepseek")).lower()
    model = (agent.llm_model if agent and agent.llm_model else os.getenv("DEEPSEEK_MODEL", "deepseek-chat"))

    if provider == "anthropic":
        try:
            from livekit.plugins import anthropic
        except ImportError as e:
            raise RuntimeError(
                "Anthropic plugin not installed. Add it to requirements (livekit-agents[anthropic])."
            ) from e
        return anthropic.LLM(
            model=model or "claude-sonnet-4-5",
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )

    if provider == "minimax":
        return openai.LLM(
            model=model or "MiniMax-M2",
            base_url=os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
            api_key=os.environ["MINIMAX_API_KEY"],
        )

    if provider == "openai":
        return openai.LLM(model=model or "gpt-4o-mini", api_key=os.environ["OPENAI_API_KEY"])

    # Default: DeepSeek (OpenAI-compatible, cheaper, no censorship issues for FR/EN calls)
    ds_model = model if (model and model.startswith("deepseek-")) else "deepseek-chat"
    return openai.LLM(
        model=ds_model,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        api_key=os.environ["DEEPSEEK_API_KEY"],
    )


def _tts_for(agent: Optional[AxonAgent]) -> minimax.TTS:
    kwargs: dict = {}
    voice = (agent.tts_voice_id if agent else None) or os.getenv("MINIMAX_VOICE_ID")
    if voice:
        kwargs["voice"] = voice
    if agent and agent.tts_emotion:
        kwargs["emotion"] = agent.tts_emotion
    elif emotion := os.getenv("MINIMAX_TTS_EMOTION"):
        kwargs["emotion"] = emotion
    if agent and agent.tts_speed and agent.tts_speed != 1.0:
        kwargs["speed"] = float(agent.tts_speed)
    model = (agent.tts_model if agent and agent.tts_model else os.getenv("MINIMAX_TTS_MODEL"))
    # MiniMax preset voices (Casual_Guy, Determined_Man, …) only exist on
    # speech-02-hd. Without it the API silently falls back to a default voice.
    if not model and voice:
        model = "speech-02-hd"
    if model:
        kwargs["model"] = model
    return minimax.TTS(**kwargs)


def _build_n8n_tools(agent: AxonAgent):
    """Build LiveKit function_tools restricted to the agent's whitelisted workflows."""
    if not (os.getenv("N8N_BASE_URL") and os.getenv("N8N_API_KEY")):
        return []
    if not agent.n8n_workflows:
        return []
    try:
        from n8n_tools import N8nClient, build_scoped_n8n_tools
        return build_scoped_n8n_tools(N8nClient(), agent.n8n_workflows)
    except Exception:
        logger.exception("n8n tools failed to load")
        return []


def _build_rag_tool(agent: AxonAgent):
    """function_tool that lets the LLM query the agent's pgvector corpus on demand."""
    from livekit.agents import function_tool

    @function_tool
    async def search_knowledge_base(query: str) -> str:
        """Search the agent's documentary knowledge base for relevant passages.

        Args:
            query: A natural-language question that should be matched against
                indexed documents (e.g. user just asked you a factual question).
        """
        rows = rag_search(agent.id, query, top_k=agent.rag_top_k)
        if not rows:
            return "Aucun passage pertinent trouvé."
        return "\n\n".join(
            f"[{i + 1}] ({r.get('source_name')}, sim={float(r.get('similarity', 0)):.2f})\n{r.get('content')}"
            for i, r in enumerate(rows)
        )

    return search_knowledge_base


# ─── Agent wrapper that greets via TTS only ───────────────────────────────
class AxonVoiceAgent(Agent):
    def __init__(self, *, instructions: str, tools, greeting: str):
        super().__init__(instructions=instructions, tools=tools)
        self._greeting = greeting

    async def on_enter(self) -> None:
        # Pure TTS greeting — avoids an LLM call with an empty user message.
        if self._greeting:
            await self.session.say(text=self._greeting, allow_interruptions=True)


async def _watch_handoff(ctx: JobContext, session: AgentSession) -> None:
    """When room metadata gains `handoff_to`, hot-swap to that agent.

    The sibling handoff API patches the LiveKit room metadata; we react
    in-process so the same call seamlessly switches persona.
    """
    seen: Optional[str] = handoff_target_from_metadata(ctx.room.metadata)

    def _on_meta_changed(*_args, **_kwargs) -> None:
        nonlocal seen
        target = handoff_target_from_metadata(ctx.room.metadata)
        if not target or target == seen:
            return
        seen = target
        try:
            axon_next = load_agent(target)
        except Exception:
            logger.exception("handoff: failed to load agent %s", target)
            return
        if not axon_next:
            logger.warning("handoff: agent %s not found", target)
            return
        try:
            session.llm = _llm_for(axon_next)
            session.tts = _tts_for(axon_next)
            logger.info("handoff: swapped persona -> %s (%s)", axon_next.id, axon_next.name)
        except Exception:
            logger.exception("handoff: hot-swap failed")

    for name in ("metadata_changed", "room_metadata_changed"):
        try:
            ctx.room.on(name, _on_meta_changed)
            return
        except Exception:
            continue
    logger.debug("handoff watcher: no metadata_changed event on this LiveKit version")


def _wire_debug_logs(session: AgentSession, clog) -> None:
    """Log every STT transcript and every assistant turn — runs for ALL sessions,
    not just calls with a call_id. Helps diagnose silent LLM/TTS failures."""

    def _on_user(ev):
        try:
            text = getattr(ev, "transcript", None) or getattr(ev, "text", None) or ""
            is_final = getattr(ev, "is_final", True)
            clog.info("STT user (final=%s): %r", is_final, str(text)[:200])
        except Exception:
            clog.exception("debug STT hook failed")

    def _on_item(ev):
        try:
            item = getattr(ev, "item", None)
            role = getattr(item, "role", None) if item else None
            text = getattr(item, "text_content", None) if item else None
            if callable(text):
                text = text()
            clog.info("LLM/turn role=%s text=%r", role, str(text or "")[:300])
        except Exception:
            clog.exception("debug item hook failed")

    def _on_error(ev):
        clog.error("session error event: %r", ev)

    for ev_name, fn in (
        ("user_input_transcribed", _on_user),
        ("conversation_item_added", _on_item),
        ("error", _on_error),
    ):
        try:
            session.on(ev_name, fn)
        except Exception:
            clog.debug("session.on(%s) unavailable", ev_name)


def _wire_transcript_hooks(session: AgentSession, call_id: Optional[str]) -> None:
    """Subscribe to session events to push each turn into call_transcripts.

    LiveKit Agents emit `user_input_transcribed` (customer side, from STT)
    and `conversation_item_added` (assistant side, after LLM/TTS). We try
    both — version-tolerant.
    """
    if not call_id:
        return

    def _on_user_transcribed(ev):
        try:
            text = getattr(ev, "transcript", None) or getattr(ev, "text", None) or ""
            if not text:
                return
            if not getattr(ev, "is_final", True):
                return
            lang = getattr(ev, "language", None)
            conf = getattr(ev, "confidence", None)
            append_transcript_turn(
                call_id,
                speaker="customer",
                text=str(text),
                confidence=float(conf) if conf is not None else None,
                language=str(lang) if lang else None,
            )
        except Exception:
            logger.exception("transcript hook (user) failed")

    def _on_item_added(ev):
        try:
            item = getattr(ev, "item", None)
            role = getattr(item, "role", None) if item else None
            text = getattr(item, "text_content", None) if item else None
            if callable(text):
                text = text()
            if not text or role not in ("assistant",):
                return
            append_transcript_turn(call_id, speaker="agent_ai", text=str(text))
        except Exception:
            logger.exception("transcript hook (assistant) failed")

    for ev_name, fn in (
        ("user_input_transcribed", _on_user_transcribed),
        ("conversation_item_added", _on_item_added),
    ):
        try:
            session.on(ev_name, fn)
        except Exception:
            logger.debug("session.on(%s) unavailable on this LiveKit version", ev_name)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    # Flow runtime path — if room metadata carries flow_id, drive the IVR
    # state machine instead of running a single-agent persona.
    flow_id = flow_id_from_metadata(ctx.room.metadata)
    call_id = call_id_from_metadata(ctx.room.metadata)
    # Per-call logger: every line carries [call_id=…] for traceability.
    clog = _logger_for_call(call_id)
    if flow_id:
        clog.info("flow_id=%s detected — booting FlowRuntime", flow_id)
        runtime = FlowRuntime(call_id=call_id)
        try:
            await runtime.load(flow_id)
        except Exception:
            clog.exception("failed to load flow %s — falling back to single-agent mode", flow_id)
        else:
            # A session is still required to drive say()/STT during the flow.
            session = AgentSession(
                stt=deepgram.STT(model="nova-3", language="multi"),
                llm=_llm_for(None),
                tts=_tts_for(None),
                vad=silero.VAD.load(),
                turn_detection=MultilingualModel(),
            )
            await session.start(
                room=ctx.room,
                agent=AxonVoiceAgent(
                    instructions="You are an IVR runtime; follow flow instructions.",
                    tools=[],
                    greeting="",
                ),
            )
            _wire_transcript_hooks(session, call_id)
            await _watch_handoff(ctx, session)
            try:
                await runtime.execute(session, ctx)
            finally:
                trigger_post_call_pipeline(call_id)
            return

    # Resolve which agent persona this room is for.
    # Wait for the user to fully join so participant attributes/metadata are
    # populated — without this, ctx.room.remote_participants is often still
    # empty here (race condition) and we fall through to plugin defaults.
    try:
        participant = await ctx.wait_for_participant()
    except Exception:
        participant = None

    p_attrs: dict = {}
    p_meta: Optional[str] = None
    if participant is not None:
        p_attrs = dict(getattr(participant, "attributes", None) or {})
        p_meta = getattr(participant, "metadata", None) or None

    agent_id = resolve_agent_id(
        room_metadata=ctx.room.metadata,
        participant_attributes=p_attrs,
    )
    if not agent_id and p_meta:
        # Participant metadata also carries `{"agent_id": "..."}` (set by the
        # /api/token route alongside attributes).
        agent_id = _agent_id_from_metadata(p_meta)
    if not agent_id:
        # Last-ditch sweep of any other remote participants already in the room.
        for p in ctx.room.remote_participants.values():
            attrs = getattr(p, "attributes", None) or {}
            if attrs.get("agent_id"):
                agent_id = str(attrs["agent_id"])
                break

    clog.info(
        "resolved agent_id=%s (room_meta=%s, p_attrs_keys=%s, p_meta=%s)",
        agent_id, bool(ctx.room.metadata), list(p_attrs.keys()), bool(p_meta),
    )
    axon = load_agent(agent_id) if agent_id else None
    if axon:
        clog.info(
            "loaded agent %s (%s) voice=%s model=%s",
            axon.id, axon.name, axon.tts_voice_id, axon.tts_model,
        )
        if axon.hold_music_url:
            clog.info(
                "org %s hold music wired: %s", axon.org_id, axon.hold_music_url
            )
            try:
                import json as _json

                current_meta = ctx.room.metadata or "{}"
                try:
                    meta = _json.loads(current_meta) if current_meta else {}
                except Exception:
                    meta = {}
                if isinstance(meta, dict):
                    meta.setdefault("hold_music_url", axon.hold_music_url)
                    meta.setdefault("org_id", axon.org_id)
                    try:
                        ctx.room._metadata = _json.dumps(meta)  # type: ignore[attr-defined]
                    except Exception:
                        pass
            except Exception:
                clog.debug("could not expose hold_music_url on room metadata")
    else:
        clog.info("no agent_id resolved; using env defaults")

    instructions = axon.system_prompt if axon else (
        "Tu es un assistant vocal multilingue (FR/EN). Sois concis et conversationnel."
    )
    greeting = axon.greeting if axon else (
        "Bonjour, je suis votre assistant vocal. Je vous écoute."
    )

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=_llm_for(axon),
        tts=_tts_for(axon),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    tools = []
    if axon:
        tools.extend(_build_n8n_tools(axon))
        if axon.rag_enabled:
            tools.append(_build_rag_tool(axon))
            clog.info("RAG tool enabled (top-%d)", axon.rag_top_k)
        # Multi-agent swarm: add `transfer_to_specialist` if this agent
        # belongs to a team. Non-blocking: returns None when no team.
        try:
            swarm_tool = build_transfer_tool(axon.id, ctx.room)
        except Exception:
            clog.exception("swarm tool build failed; continuing without it")
            swarm_tool = None
        if swarm_tool is not None:
            tools.append(swarm_tool)
            clog.info("swarm: transfer_to_specialist tool enabled")
    else:
        # legacy path: env-only n8n tools
        if os.getenv("N8N_BASE_URL") and os.getenv("N8N_API_KEY"):
            try:
                from n8n_tools import N8nClient, build_n8n_tools
                tools = build_n8n_tools(N8nClient())
                clog.info("n8n tools enabled (%d) — legacy mode", len(tools))
            except Exception:
                clog.exception("n8n tools failed to load")

    await session.start(
        room=ctx.room,
        agent=AxonVoiceAgent(
            instructions=instructions,
            tools=tools,
            greeting=greeting,
        ),
    )
    _wire_transcript_hooks(session, call_id)
    _wire_debug_logs(session, clog)

    async def _on_shutdown():
        try:
            trigger_post_call_pipeline(call_id)
        except Exception:
            clog.exception("post-call pipeline trigger failed")

    try:
        ctx.add_shutdown_callback(_on_shutdown)
    except Exception:
        # Older LiveKit versions don't expose add_shutdown_callback — best-effort.
        clog.debug("ctx.add_shutdown_callback unavailable; skipping post-call hook")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
