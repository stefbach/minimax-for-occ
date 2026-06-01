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
    load_campaign_script,
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
from swarm import build_transfer_tool, build_handoff_to_handle_tool

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
    model = (agent.llm_model if agent and agent.llm_model else os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"))

    # Cap the response length so a chatty model can't blow our per-turn budget.
    # 220 tokens ≈ 160 words ≈ ~40s of TTS audio — plenty for conversational
    # replies, and bounds the worst-case TTFT→last-chunk latency. Tunable via env.
    max_tokens = int(os.getenv("LLM_MAX_COMPLETION_TOKENS", "220"))

    if provider == "anthropic":
        try:
            from livekit.plugins import anthropic
        except ImportError as e:
            raise RuntimeError(
                "Anthropic plugin not installed. Add it to requirements (livekit-agents[anthropic])."
            ) from e
        return _build_llm_with_max_tokens(
            anthropic.LLM,
            max_tokens,
            model=model or "claude-sonnet-4-5",
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )

    if provider == "minimax":
        return _build_llm_with_max_tokens(
            openai.LLM,
            max_tokens,
            model=model or "MiniMax-M2",
            base_url=os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
            api_key=os.environ["MINIMAX_API_KEY"],
        )

    if provider == "openai":
        return _build_llm_with_max_tokens(
            openai.LLM,
            max_tokens,
            model=model or "gpt-4o-mini",
            api_key=os.environ["OPENAI_API_KEY"],
        )

    # Default: DeepSeek (OpenAI-compatible, cheaper, no censorship issues for FR/EN calls)
    ds_model = model if (model and model.startswith("deepseek-")) else "deepseek-v4-flash"
    return _build_llm_with_max_tokens(
        openai.LLM,
        max_tokens,
        model=ds_model,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        api_key=os.environ["DEEPSEEK_API_KEY"],
    )


def _build_llm_with_max_tokens(cls, max_tokens: int, **kwargs):
    """Instantiate an LLM plugin and try to pass a per-completion token cap.
    Different plugin versions name the kwarg differently (max_tokens,
    max_completion_tokens) — signature-filter so we don't crash on the version
    that doesn't accept it. Falls back to the bare constructor as a last resort.
    """
    import inspect
    try:
        supported = set(inspect.signature(cls.__init__).parameters)
    except (ValueError, TypeError):
        supported = set()
    for name in ("max_completion_tokens", "max_tokens"):
        if name in supported:
            try:
                return cls(**{**kwargs, name: max_tokens})
            except TypeError:
                continue
    return cls(**kwargs)


def _stt_for(agent: Optional[AxonAgent]) -> deepgram.STT:
    """Deepgram STT — honors the per-agent language stored in Supabase.
    - 'multi' / unset → auto-detect (30+ languages, broadest coverage)
    - 'fr', 'en', 'es', … → locked language for max accuracy on short turns

    Telephony-specific tuning: on 8kHz G.711 PSTN audio Deepgram defaults to a
    conservative endpointing (~500ms+ silence before finalizing) which adds a
    very perceptible 500-700ms to every conversational turn vs. the same agent
    in a clean Opus browser session. We push `endpointing_ms` lower and keep
    `utterance_end_ms` as a safety net for long sentences. Both are
    signature-filtered so older plugin versions that don't accept the kwargs
    silently drop them instead of crashing.
    """
    import inspect

    lang = (agent.language if agent and agent.language else "multi").lower()
    if lang in ("multi", "auto", ""):
        lang = "multi"

    candidate: dict = {
        "model": "nova-3",
        "language": lang,
        "endpointing_ms": int(os.getenv("DEEPGRAM_ENDPOINTING_MS", "300")),
        "utterance_end_ms": int(os.getenv("DEEPGRAM_UTTERANCE_END_MS", "700")),
        "interim_results": True,
    }
    try:
        supported = set(inspect.signature(deepgram.STT.__init__).parameters)
    except (ValueError, TypeError):
        supported = {"model", "language"}
    kwargs = {k: v for k, v in candidate.items() if k in supported}
    return deepgram.STT(**kwargs)


def _tts_for(agent: Optional[AxonAgent]) -> minimax.TTS:
    import inspect

    voice = (agent.tts_voice_id if agent else None) or os.getenv("MINIMAX_VOICE_ID")
    model = (agent.tts_model if agent and agent.tts_model else os.getenv("MINIMAX_TTS_MODEL"))
    # MiniMax preset voices (Casual_Guy, Determined_Man, …) only exist on the
    # *-hd models. Without one the API silently falls back to a default voice.
    if not model and voice:
        model = "speech-02-hd"

    emotion = (agent.tts_emotion if agent and agent.tts_emotion else os.getenv("MINIMAX_TTS_EMOTION")) or None
    # The "fluent" emotion only exists on speech-2.6-* models; drop it otherwise
    # so we never hit the plugin's ValueError mid-call.
    if emotion == "fluent" and not (model or "").startswith("speech-2.6"):
        emotion = None

    # Lock language_boost to the agent's configured language for cleaner
    # prosody/pronunciation; "multi"/unknown → "auto" (let MiniMax detect).
    lang = (agent.language if agent and agent.language else "multi").lower()
    boost = {
        "fr": "French",
        "en": "English",
        "es": "Spanish",
        "de": "German",
        "it": "Italian",
        "pt": "Portuguese",
        "nl": "Dutch",
        "ar": "Arabic",
    }.get(lang) or os.getenv("MINIMAX_LANGUAGE_BOOST", "auto")

    candidate: dict = {
        "voice": voice,
        "model": model,
        "emotion": emotion,
        "speed": float(agent.tts_speed) if agent and agent.tts_speed and agent.tts_speed != 1.0 else None,
        "vol": float(agent.tts_volume) if agent and agent.tts_volume and agent.tts_volume != 1.0 else None,
        "pitch": int(agent.tts_pitch) if agent and agent.tts_pitch else None,
        "language_boost": boost,
        # Force PCM streaming instead of MP3. MiniMax streams MP3 as multiple
        # chunks each with their own headers, which crashes livekit-agents'
        # PyAV decoder with InvalidDataError 1094995529 (livekit/livekit#3850,
        # agents#3863). Raw PCM has no per-chunk headers so concatenation works.
        "audio_format": "pcm",
    }

    # Only pass kwargs that (a) have a value and (b) the installed plugin
    # actually accepts — robust across plugin versions, no more TypeErrors.
    try:
        supported = set(inspect.signature(minimax.TTS.__init__).parameters)
    except (ValueError, TypeError):
        supported = set(candidate)
    kwargs = {k: v for k, v in candidate.items() if v is not None and k in supported}

    try:
        return minimax.TTS(**kwargs)
    except TypeError:
        kwargs.pop("audio_format", None)
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
            # PSTN audio path takes ~1-2s to fully establish after pickup; wait
            # so the callee doesn't miss the first words of the greeting (used
            # to hear only "…fonctionne correctement" instead of the full line).
            await asyncio.sleep(2.0)
            import time as _t
            _b = _t.monotonic()
            logger.info("greeting: say() begin")
            await self.session.say(text=self._greeting, allow_interruptions=True)
            logger.info("greeting: say() returned in %.2fs", _t.monotonic() - _b)


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


def _wire_latency_metrics(session: AgentSession, clog: logging.LoggerAdapter) -> None:
    """Log per-turn LLM / TTS / EOU latency. livekit-agents emits a
    `metrics_collected` event with typed payloads (LLMMetrics, TTSMetrics,
    EOUMetrics, …) that include `ttft` and `duration` fields. We aggregate
    one tidy line per turn instead of one log per stage.

    Also surfaces DeepSeek prompt-cache hits when present in the LLM usage
    (DeepSeek auto-caches matching prefixes — 10× cheaper + lower TTFT — and
    reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` in
    `LLMMetrics.usage` or as raw keys on the chunk).
    """
    state: dict = {"llm_ttft": None, "llm_total": None, "tts_ttft": None,
                   "eou_delay": None, "cache_hit": None, "cache_miss": None}

    def _flush_if_ready():
        if state["llm_ttft"] is None and state["tts_ttft"] is None:
            return
        parts = []
        if state["eou_delay"] is not None:
            parts.append(f"EOU={int(state['eou_delay']*1000)}ms")
        if state["llm_ttft"] is not None:
            parts.append(f"LLM-TTFT={int(state['llm_ttft']*1000)}ms")
        if state["llm_total"] is not None:
            parts.append(f"LLM-total={int(state['llm_total']*1000)}ms")
        if state["tts_ttft"] is not None:
            parts.append(f"TTS-TTFT={int(state['tts_ttft']*1000)}ms")
        if state["cache_hit"] is not None:
            parts.append(f"cache_hit={state['cache_hit']}/miss={state['cache_miss']}")
        clog.info("turn latency: %s", " · ".join(parts))
        for k in state:
            state[k] = None

    def _on_metrics(ev):
        try:
            metrics = getattr(ev, "metrics", None) or ev
            cls = type(metrics).__name__
            if cls == "LLMMetrics":
                state["llm_ttft"] = getattr(metrics, "ttft", None)
                state["llm_total"] = getattr(metrics, "duration", None)
                usage = getattr(metrics, "usage", None) or {}
                # DeepSeek exposes these on the chat-completion response; the
                # plugin may forward them under .usage as a dict OR as object
                # attributes depending on version.
                def _get(name):
                    if isinstance(usage, dict):
                        return usage.get(name)
                    return getattr(usage, name, None)
                hit = _get("prompt_cache_hit_tokens")
                miss = _get("prompt_cache_miss_tokens")
                if hit is not None or miss is not None:
                    state["cache_hit"] = hit
                    state["cache_miss"] = miss
            elif cls == "TTSMetrics":
                state["tts_ttft"] = getattr(metrics, "ttft", None)
                # TTS metric arrives last in a turn → flush here.
                _flush_if_ready()
            elif cls == "EOUMetrics":
                # End-of-utterance: how long after the user stopped before we
                # considered the turn complete. Combines VAD + endpointing.
                state["eou_delay"] = getattr(metrics, "end_of_utterance_delay", None)
        except Exception:
            clog.exception("latency metrics hook failed")

    for ev_name in ("metrics_collected", "metrics"):
        try:
            session.on(ev_name, _on_metrics)
            break
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
            _td_mode = os.getenv("TURN_DETECTOR", "vad").lower()
            session = AgentSession(
                stt=_stt_for(None),
                llm=_llm_for(None),
                tts=_tts_for(None),
                vad=silero.VAD.load(),
                turn_detection=(
                    MultilingualModel() if _td_mode == "multilingual" else "vad"
                ),
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
            _wire_latency_metrics(session, clog)
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
    # 10 s timeout so we never block forever if something is off.
    participant = None
    try:
        # 40s (not 10s): for LiveKit-originated outbound calls the agent is
        # dispatched before the callee answers, so we may wait the full ring
        # duration for the SIP participant to join. wait_for_participant returns
        # as soon as someone arrives, so this is harmless for inbound calls.
        participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=40.0)
    except (asyncio.TimeoutError, Exception):
        # Fall back to whatever participants are already in the room.
        for p in ctx.room.remote_participants.values():
            participant = p
            break

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
        # Check both ``agent_id`` (browser/desk) and ``axon.agent_id`` (SIP).
        for p in ctx.room.remote_participants.values():
            attrs = getattr(p, "attributes", None) or {}
            for key in ("agent_id", "sip.h.x-lk-agent-id", "axon.agent_id"):
                val = attrs.get(key)
                if val and not str(val).startswith("X-LK-"):
                    agent_id = str(val)
                    break
            if agent_id:
                break

    clog.info(
        "resolved agent_id=%s (room_meta=%s, p_attrs_keys=%s, p_meta=%s)",
        agent_id, bool(ctx.room.metadata), list(p_attrs.keys()), bool(p_meta),
    )
    # Resolve campaign_id now (same sip.h.* gotcha as agent_id: the real value
    # is in the forwarded SIP header attribute; `axon.campaign_id` is the broken
    # dispatch-rule mapping that yields the literal "X-LK-Campaign-Id").
    campaign_id = (
        p_attrs.get("sip.h.x-lk-campaign-id")
        or p_attrs.get("campaign_id")
        or p_attrs.get("axon.campaign_id")
    )
    if campaign_id and str(campaign_id).startswith("X-LK-"):
        campaign_id = None

    # Load the agent config and the campaign script CONCURRENTLY and off the
    # asyncio event loop (both are blocking httpx calls to Supabase). Running
    # them in parallel — instead of back-to-back, and without blocking the loop
    # that drives the room/audio — cuts the dead-air the caller hears before
    # the agent greets.
    async def _load(fn, arg):
        return await asyncio.to_thread(fn, str(arg)) if arg else None

    axon, script_text = await asyncio.gather(
        _load(load_agent, agent_id),
        _load(load_campaign_script, campaign_id),
    )

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

    # Tone/style directive (item 3): shape the LLM's register without changing
    # the TTS voice. Complements the MiniMax emotion setting.
    if axon and axon.voice_style:
        instructions = (
            f"{instructions}\n\nStyle et ton à adopter pendant tout l'appel : "
            f"{axon.voice_style}. Reste naturel et conversationnel, adapté à la voix."
        )

    if campaign_id and script_text:
        clog.info("campaign %s script injected (%d chars)", campaign_id, len(script_text))
        instructions = f"{instructions}\n\n{script_text}"
    elif campaign_id:
        clog.info("campaign %s has no script — using agent base prompt", campaign_id)

    # Reuse the VAD loaded once at worker startup (prewarm) instead of paying
    # the model-load cost on every single call — that load was part of the
    # delay before the agent could start listening/speaking.
    vad = (ctx.proc.userdata.get("vad") if getattr(ctx, "proc", None) else None) or silero.VAD.load()

    import inspect as _inspect

    # Turn detector choice — the single biggest knob for per-turn EOU latency:
    #  • "vad"  → VAD-only endpointing. Fastest (~600-900ms EOU) but can cut
    #             off speakers who pause mid-sentence.
    #  • "multilingual" → transformer model that reads the transcript to decide
    #             if the user actually finished. Smarter but adds 1-2s per turn
    #             and saturates the CPU (silero throws "slower than realtime").
    # Default is now "vad" because real-world tests on Fly cdg showed EOU=2.5s+
    # with the multilingual model. Override via TURN_DETECTOR=multilingual.
    turn_detector_mode = os.getenv("TURN_DETECTOR", "vad").lower()
    if turn_detector_mode == "multilingual":
        chosen_turn_detector: object = MultilingualModel()
    else:
        chosen_turn_detector = "vad"

    session_kwargs: dict = dict(
        stt=_stt_for(axon),
        llm=_llm_for(axon),
        tts=_tts_for(axon),
        vad=vad,
    )

    # Latency & naturalness tuning. The API moved between livekit-agents
    # versions: the old top-level kwargs (min_endpointing_delay,
    # preemptive_generation, allow_interruptions, turn_detection) were
    # deprecated and silently ignored in newer builds — they live under
    # `turn_handling=TurnHandlingOptions(...)` now. We try the new API first
    # and fall back to the old kwargs otherwise. Either way, signature-filter
    # so unknown kwargs are dropped instead of crashing.
    min_endp = float(os.getenv("MIN_ENDPOINTING_DELAY", "0.30"))

    new_api_applied = False
    try:
        from livekit.agents import TurnHandlingOptions  # type: ignore
        try:
            tho_params = set(_inspect.signature(TurnHandlingOptions.__init__).parameters)
        except (ValueError, TypeError):
            tho_params = set()
        tho_candidate = {
            "preemptive_generation": True,
            "min_endpointing_delay": min_endp,
            "allow_interruptions": True,
            "turn_detection": chosen_turn_detector,
        }
        tho_kwargs = {k: v for k, v in tho_candidate.items() if k in tho_params}
        if tho_kwargs:
            try:
                _session_params = set(_inspect.signature(AgentSession.__init__).parameters)
            except (ValueError, TypeError):
                _session_params = set()
            if "turn_handling" in _session_params:
                session_kwargs["turn_handling"] = TurnHandlingOptions(**tho_kwargs)
                new_api_applied = True
                clog.info(
                    "turn_handling: TurnHandlingOptions(turn_detection=%s, min_endpointing_delay=%.2f)",
                    turn_detector_mode, min_endp,
                )
    except ImportError:
        pass

    if not new_api_applied:
        # Old API path. Pass only what this version's AgentSession accepts.
        legacy = {
            "preemptive_generation": True,
            "min_endpointing_delay": min_endp,
            "allow_interruptions": True,
            "turn_detection": chosen_turn_detector,
        }
        try:
            _session_params = set(_inspect.signature(AgentSession.__init__).parameters)
        except (ValueError, TypeError):
            _session_params = set()
        for _k, _v in legacy.items():
            if _k in _session_params:
                session_kwargs[_k] = _v
        clog.info(
            "turn handling (legacy kwargs): turn_detection=%s, min_endpointing_delay=%.2f",
            turn_detector_mode, min_endp,
        )

    session = AgentSession(**session_kwargs)

    tools = []
    if axon:
        tools.extend(_build_n8n_tools(axon))
        if axon.rag_enabled:
            tools.append(_build_rag_tool(axon))
            clog.info("RAG tool enabled (top-%d)", axon.rag_top_k)
        # Multi-agent swarm: add `transfer_to_specialist` if this agent
        # belongs to a team. Non-blocking: returns None when no team.
        import time as _time
        _t_swarm = _time.monotonic()
        try:
            swarm_tool = build_transfer_tool(axon.id, ctx.room)
        except Exception:
            clog.exception("swarm tool build failed; continuing without it")
            swarm_tool = None
        clog.info("timing: swarm tool build took %.2fs", _time.monotonic() - _t_swarm)
        if swarm_tool is not None:
            tools.append(swarm_tool)
            clog.info("swarm: transfer_to_specialist tool enabled")
        # Script-driven handoff: lets the LLM jump to a specific agent_handle
        # (AI persona swap OR SIP transfer to a human number) as the script
        # graph dictates per node.
        try:
            handoff_tool = build_handoff_to_handle_tool(ctx.room)
        except Exception:
            clog.exception("handoff_to_handle tool build failed")
            handoff_tool = None
        if handoff_tool is not None:
            tools.append(handoff_tool)
            clog.info("swarm: handoff_to_handle tool enabled")
    else:
        # legacy path: env-only n8n tools
        if os.getenv("N8N_BASE_URL") and os.getenv("N8N_API_KEY"):
            try:
                from n8n_tools import N8nClient, build_n8n_tools
                tools = build_n8n_tools(N8nClient())
                clog.info("n8n tools enabled (%d) — legacy mode", len(tools))
            except Exception:
                clog.exception("n8n tools failed to load")

    import time as _time2
    _t_start = _time2.monotonic()
    clog.info("timing: session.start() begin")
    await session.start(
        room=ctx.room,
        agent=AxonVoiceAgent(
            instructions=instructions,
            tools=tools,
            greeting=greeting,
        ),
    )
    clog.info("timing: session.start() returned in %.2fs", _time2.monotonic() - _t_start)
    _wire_transcript_hooks(session, call_id)
    _wire_latency_metrics(session, clog)
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


def prewarm(proc):
    """Load heavy models ONCE when the worker process starts, not per call.
    Silero VAD is reused across every job via proc.userdata — this removes a
    chunk of the cold pre-greeting latency the caller would otherwise hear."""
    try:
        proc.userdata["vad"] = silero.VAD.load()
    except Exception:
        # Non-fatal: the entrypoint falls back to a per-call VAD.load().
        pass


if __name__ == "__main__":
    # agent_name MUST match the name the SIP dispatch rule dispatches
    # ("minimax-voice-agent"). Without it the worker registers anonymously
    # (agent_name="") in automatic-dispatch mode, which does NOT match a rule
    # that explicitly requests a named agent — so the SIP room gets created but
    # no agent ever joins (call rings out, 487 Request Terminated, room with 0
    # participants). Naming the worker makes the dispatch explicit and
    # deterministic.
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name="minimax-voice-agent"))
