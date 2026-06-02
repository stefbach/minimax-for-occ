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
from livekit.agents.voice.background_audio import (
    AudioConfig,
    BackgroundAudioPlayer,
    BuiltinAudioClip,
)
from livekit.plugins import assemblyai, cartesia, openai, silero
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
# Cache of openai.AsyncOpenAI clients, keyed by (base_url, api_key prefix).
# Sharing a client across all agent sessions in this worker process means we
# reuse the underlying httpx connection pool — so the TCP+TLS handshake to
# DeepSeek/OpenAI (200-600ms RTT from CDG) is paid ONCE per worker boot
# instead of on every single call's first turn.
_OPENAI_CLIENTS: dict[str, object] = {}


def _shared_openai_client(base_url: str, api_key: str):
    """Return a process-wide shared AsyncOpenAI for (base_url, api_key).
    Returns None if the openai SDK isn't importable (older plugin versions),
    in which case the caller should fall back to letting the plugin create
    its own per-instance client."""
    if not base_url or not api_key:
        return None
    cache_key = f"{base_url}|{api_key[:8]}"
    cached = _OPENAI_CLIENTS.get(cache_key)
    if cached is not None:
        return cached
    try:
        from openai import AsyncOpenAI  # provided transitively by openai plugin
    except Exception:
        return None
    try:
        client = AsyncOpenAI(base_url=base_url, api_key=api_key)
    except Exception:
        return None
    _OPENAI_CLIENTS[cache_key] = client
    return client


def _llm_for(agent: Optional[AxonAgent]):
    """Build a LiveKit-Agents-compatible LLM from the agent's provider/model.

    Worker-wide A/B knobs (env): set these to swap LLM provider/model for
    EVERY call without touching any agent row in DB. Unset to return to the
    per-agent config. Useful for testing Anthropic / OpenAI alongside DeepSeek.
      • LLM_PROVIDER_FORCE = "anthropic" | "openai" | "deepseek"
      • LLM_MODEL_FORCE    = e.g. "claude-haiku-4-5-20251001"
    """
    forced_provider = os.getenv("LLM_PROVIDER_FORCE", "").strip().lower()
    forced_model = os.getenv("LLM_MODEL_FORCE", "").strip()

    provider = (
        forced_provider
        or (agent.llm_provider.lower() if agent and agent.llm_provider else "")
        or os.getenv("LLM_PROVIDER", "deepseek").lower()
    )
    model = (
        forced_model
        or (agent.llm_model if agent and agent.llm_model else "")
        or os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
    )

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
        # If the per-agent model is a deepseek/openai id (because the env
        # override was just flipped on), fall back to a sensible Claude
        # default rather than crashing on a bad model name.
        anth_model = model if model.startswith("claude") else "claude-haiku-4-5-20251001"
        return _build_llm_with_max_tokens(
            anthropic.LLM,
            max_tokens,
            model=anth_model,
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )

    if provider == "minimax":
        base_url = os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
        api_key = os.environ["MINIMAX_API_KEY"]
        return _build_llm_with_max_tokens(
            openai.LLM,
            max_tokens,
            model=model or "MiniMax-M2",
            base_url=base_url,
            api_key=api_key,
            client=_shared_openai_client(base_url, api_key),
        )

    if provider == "openai":
        api_key = os.environ["OPENAI_API_KEY"]
        return _build_llm_with_max_tokens(
            openai.LLM,
            max_tokens,
            model=model or "gpt-4o-mini",
            api_key=api_key,
            client=_shared_openai_client("https://api.openai.com/v1", api_key),
        )

    # Default: DeepSeek (OpenAI-compatible, cheaper, no censorship issues for FR/EN calls)
    ds_model = model if (model and model.startswith("deepseek-")) else "deepseek-v4-flash"
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    api_key = os.environ["DEEPSEEK_API_KEY"]
    return _build_llm_with_max_tokens(
        openai.LLM,
        max_tokens,
        model=ds_model,
        base_url=base_url,
        api_key=api_key,
        client=_shared_openai_client(base_url, api_key),
    )


def _build_llm_with_max_tokens(cls, max_tokens: int, **kwargs):
    """Instantiate an LLM plugin and try to pass a per-completion token cap.
    Different plugin versions name the kwarg differently (max_tokens,
    max_completion_tokens) — signature-filter so we don't crash on the version
    that doesn't accept it. Also drops `client=None` and `client=...` for
    plugin versions that don't accept a pre-built client.
    """
    import inspect
    try:
        supported = set(inspect.signature(cls.__init__).parameters)
    except (ValueError, TypeError):
        supported = set()
    # Drop `client` kwarg if (a) None or (b) not supported by this plugin version.
    if "client" in kwargs and (kwargs["client"] is None or "client" not in supported):
        kwargs.pop("client", None)
    for name in ("max_completion_tokens", "max_tokens"):
        if name in supported:
            try:
                return cls(**{**kwargs, name: max_tokens})
            except TypeError:
                continue
    return cls(**kwargs)


def _stt_for(agent: Optional[AxonAgent]) -> assemblyai.STT:
    """AssemblyAI Universal Streaming STT — honors the per-agent language.

    Replaced Deepgram nova-3: AssemblyAI Universal Streaming targets
    sub-300ms transcription delay vs Deepgram's 700-1400ms on 8kHz PSTN.

    Model selection:
      - 'en' only agent → universal-streaming-english (fastest English path)
      - anything else   → universal-streaming-multilingual (FR/EN/ES/DE/…)
    Override via ASSEMBLYAI_MODEL env for global A/B across all sessions.

    Latency tuning (all signature-filtered for version safety):
      - end_of_turn_confidence_threshold: lower → faster EOU detection, higher
        risk of mid-sentence cut-offs. 0.7 is a balanced starting point.
      - min_turn_silence: minimum ms of silence before declaring turn end.
        250ms is aggressive but paired with quick-ack prompt trick.
    """
    import inspect

    lang = (agent.language if agent and agent.language else "multi").lower()
    model = (
        "universal-streaming-english"
        if lang == "en"
        else "universal-streaming-multilingual"
    )
    model = os.getenv("ASSEMBLYAI_MODEL", model)

    candidate: dict = {
        "model": model,
        "end_of_turn_confidence_threshold": float(
            os.getenv("ASSEMBLYAI_EOT_THRESHOLD", "0.7")
        ),
        "min_turn_silence": int(os.getenv("ASSEMBLYAI_MIN_TURN_SILENCE", "250")),
        "continuous_partials": True,
    }
    api_key = os.getenv("ASSEMBLYAI_API_KEY")
    if api_key:
        candidate["api_key"] = api_key

    try:
        supported = set(inspect.signature(assemblyai.STT.__init__).parameters)
    except (ValueError, TypeError):
        supported = {"model"}
    kwargs = {k: v for k, v in candidate.items() if k in supported}
    return assemblyai.STT(**kwargs)


def _tts_for(agent: Optional[AxonAgent]) -> cartesia.TTS:
    """Cartesia Sonic TTS — honors the per-agent voice/language/speed.

    Replaced MiniMax for lower TTFB: Cartesia Sonic targets ~90ms
    time-to-first-byte vs MiniMax's 400-800ms over the China RTT.

    Voice IDs are Cartesia UUIDs (browse at play.cartesia.ai or via the
    Axon admin UI which fetches the live catalog from Cartesia's API).
    The per-agent tts_voice_id is stored in Supabase; if unset, Cartesia's
    default voice is used. Override globally via CARTESIA_VOICE_ID.

    Cartesia does not have a pitch control — the tts_pitch field in the DB
    is ignored. Speed and volume are supported.
    """
    import inspect

    lang = (agent.language if agent and agent.language else "multi").lower()
    # Cartesia language codes: ISO 639-1. "multi"/unset → None → Cartesia
    # infers from the text. Override via env for global A/B testing.
    cartesia_lang = os.getenv(
        "CARTESIA_LANGUAGE",
        None if lang in ("multi", "auto", "") else lang,
    )

    model = (
        (agent.tts_model if agent and agent.tts_model else None)
        or os.getenv("CARTESIA_MODEL", "sonic-3")
    )

    voice = (
        (agent.tts_voice_id if agent and agent.tts_voice_id else None)
        or os.getenv("CARTESIA_VOICE_ID")
    )

    speed = (
        float(agent.tts_speed)
        if agent and agent.tts_speed and agent.tts_speed != 1.0
        else None
    )

    volume = (
        float(agent.tts_volume)
        if agent and agent.tts_volume and agent.tts_volume != 1.0
        else None
    )

    # Cartesia emotion is a list of strings (TTSVoiceEmotion literals).
    # tts_emotion stores one emotion string; wrap in list for the plugin.
    emotion_raw = (agent.tts_emotion if agent and agent.tts_emotion else None)
    emotion: Optional[list] = [emotion_raw] if emotion_raw else None

    candidate: dict = {
        "model": model,
        "language": cartesia_lang,
        "speed": speed,
        "emotion": emotion,
        "volume": volume,
    }
    if voice:
        candidate["voice"] = voice
    api_key = os.getenv("CARTESIA_API_KEY")
    if api_key:
        candidate["api_key"] = api_key

    try:
        supported = set(inspect.signature(cartesia.TTS.__init__).parameters)
    except (ValueError, TypeError):
        supported = set(candidate)
    kwargs = {k: v for k, v in candidate.items() if v is not None and k in supported}
    return cartesia.TTS(**kwargs)


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
            # Brief pre-roll so the first words don't get clipped on slower
            # PSTN setups (UK Twilio trunk takes ~2s to fully establish the
            # audio path after pickup; Mauritius is faster). Configurable via
            # env so we can A/B without redeploying.
            preroll = float(os.getenv("GREETING_PREROLL_SECONDS", "1.0"))
            if preroll > 0:
                await asyncio.sleep(preroll)
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
    state: dict = {"llm_ttft": None, "llm_total": None, "tts_ttfb": None,
                   "eou_delay": None, "transcription_delay": None,
                   "user_turn_delay": None, "cached_tokens": None,
                   "prompt_tokens": None, "completion_tokens": None,
                   "tokens_per_sec": None}
    # Flush is debounced. Why 2500ms (not 600): EOU and LLM-TTFT can arrive
    # 1.5s+ apart on cold turns (DeepSeek China RTT). With a tight window each
    # metric flushed in its own line — we want one consolidated line per turn.
    pending: dict = {"task": None}

    def _flush_now():
        if all(state[k] is None for k in state):
            return
        parts = []
        if state["eou_delay"] is not None:
            parts.append(f"EOU={int(state['eou_delay']*1000)}ms")
        if state["transcription_delay"] is not None:
            parts.append(f"STT-delay={int(state['transcription_delay']*1000)}ms")
        if state["user_turn_delay"] is not None:
            parts.append(f"turn-complete={int(state['user_turn_delay']*1000)}ms")
        if state["llm_ttft"] is not None:
            parts.append(f"LLM-TTFT={int(state['llm_ttft']*1000)}ms")
        if state["llm_total"] is not None:
            parts.append(f"LLM-total={int(state['llm_total']*1000)}ms")
        if state["tts_ttfb"] is not None:
            parts.append(f"TTS-TTFB={int(state['tts_ttfb']*1000)}ms")
        if state["cached_tokens"] is not None and state["prompt_tokens"]:
            ratio = int(100 * state["cached_tokens"] / state["prompt_tokens"])
            parts.append(
                f"cache={state['cached_tokens']}/{state['prompt_tokens']}({ratio}%)"
            )
        if state["prompt_tokens"] is not None:
            parts.append(
                f"tokens={state['prompt_tokens']}→{state['completion_tokens']}"
            )
        if state["tokens_per_sec"] is not None:
            parts.append(f"{state['tokens_per_sec']:.0f}tok/s")
        clog.info("turn latency: %s", " · ".join(parts))
        for k in state:
            state[k] = None

    def _schedule_flush():
        prev = pending["task"]
        if prev is not None and not prev.done():
            prev.cancel()
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            return

        async def _delayed():
            try:
                await asyncio.sleep(2.5)
                _flush_now()
            except asyncio.CancelledError:
                pass

        pending["task"] = loop.create_task(_delayed())

    def _on_metrics(ev):
        try:
            metrics = getattr(ev, "metrics", None) or ev
            cls = type(metrics).__name__
            if cls == "LLMMetrics":
                # Field names confirmed from the discovered-fields log:
                # LLMMetrics exposes prompt_tokens / completion_tokens /
                # prompt_cached_tokens / ttft / duration / tokens_per_second
                # directly as attributes (no nested .usage object).
                state["llm_ttft"] = getattr(metrics, "ttft", None)
                state["llm_total"] = getattr(metrics, "duration", None)
                state["prompt_tokens"] = getattr(metrics, "prompt_tokens", None)
                state["completion_tokens"] = getattr(metrics, "completion_tokens", None)
                state["cached_tokens"] = getattr(metrics, "prompt_cached_tokens", None)
                state["tokens_per_sec"] = getattr(metrics, "tokens_per_second", None)
            elif cls == "TTSMetrics":
                # TTSMetrics uses `ttfb` (time-to-first-byte), NOT `ttft`. The
                # previous version of this hook looked for ttft and silently
                # missed every TTS metric — explains the missing TTS line in
                # earlier turn-latency logs.
                state["tts_ttfb"] = getattr(metrics, "ttfb", None)
            elif cls == "EOUMetrics":
                # End-of-utterance: three distinct delays surfaced by the
                # plugin. We log all so we can see exactly which stage adds
                # the time:
                #  - end_of_utterance_delay: VAD + endpointing decision
                #  - transcription_delay: Deepgram between final speech & final text
                #  - on_user_turn_completed_delay: total handoff to LLM
                state["eou_delay"] = getattr(metrics, "end_of_utterance_delay", None)
                state["transcription_delay"] = getattr(metrics, "transcription_delay", None)
                state["user_turn_delay"] = getattr(
                    metrics, "on_user_turn_completed_delay", None
                )
            else:
                return  # unknown metric type — don't bother flushing
            _schedule_flush()
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

    # Perceived-latency trick used by Retell / Vapi / ElevenLabs Conversational:
    # force the LLM to ALWAYS start its replies with a 1-2 word acknowledgement
    # so TTS streaming begins on the very first token. Kept as short as
    # possible (~15 tokens) so it doesn't bloat the system prompt and trash
    # the DeepSeek prefix cache (every byte change = miss).
    if os.getenv("QUICK_ACK", "true").lower() not in ("false", "0", "no"):
        instructions = (
            f"{instructions}\n"
            "Commence chaque réponse par un mot court (Oui, D'accord, "
            "Bien sûr, Hmm), puis la réponse."
        )

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

    # Phase 1B — Filler audio. When the LLM is "thinking" after the user
    # speaks, the caller currently hears 1.5-2s of total silence
    # (EOU + STT-delay + LLM-TTFT). BackgroundAudioPlayer publishes a
    # second audio track to the room and automatically plays a "thinking"
    # sound when the agent enters that state. Caller hears an immediate
    # cue (~100-200ms after they stop) that the agent is processing →
    # perceived latency drops by ~1s even though real latency is unchanged.
    # Default OFF — user feedback was that the keyboard-typing sound felt
    # weird on a phone call. Re-enable per-deploy with FILLER_AUDIO=true.
    if os.getenv("FILLER_AUDIO", "false").lower() in ("true", "1", "yes"):
        try:
            # Pick the clip via env so we can iterate without code changes.
            # KEYBOARD_TYPING is the standard "I'm thinking" sound used by
            # most voice agents — discreet, recognizable, doesn't compete
            # with speech. OFFICE_AMBIENCE adds low-volume room tone so the
            # line never feels "dead" between turns.
            clip_name = os.getenv("FILLER_AUDIO_CLIP", "KEYBOARD_TYPING").upper()
            ambient_name = os.getenv("FILLER_AMBIENT_CLIP", "").upper()
            try:
                thinking_clip = BuiltinAudioClip[clip_name]
            except KeyError:
                clog.warning("Unknown FILLER_AUDIO_CLIP=%s, using KEYBOARD_TYPING", clip_name)
                thinking_clip = BuiltinAudioClip.KEYBOARD_TYPING
            ambient_clip = None
            if ambient_name:
                try:
                    ambient_clip = BuiltinAudioClip[ambient_name]
                except KeyError:
                    clog.warning("Unknown FILLER_AMBIENT_CLIP=%s, skipping ambient", ambient_name)

            # Volume defaults are low so the filler is audible but unobtrusive.
            thinking_vol = float(os.getenv("FILLER_AUDIO_VOLUME", "0.6"))
            ambient_vol = float(os.getenv("FILLER_AMBIENT_VOLUME", "0.15"))

            player = BackgroundAudioPlayer(
                thinking_sound=AudioConfig(thinking_clip, volume=thinking_vol),
                ambient_sound=(
                    AudioConfig(ambient_clip, volume=ambient_vol)
                    if ambient_clip is not None
                    else None
                ),
            )
            await player.start(room=ctx.room, agent_session=session)
            clog.info(
                "filler audio enabled: thinking=%s vol=%.2f ambient=%s vol=%.2f",
                clip_name, thinking_vol, ambient_name or "none", ambient_vol,
            )
        except Exception:
            # Best-effort: filler audio is a nice-to-have, never block the call.
            clog.exception("BackgroundAudioPlayer setup failed; continuing without filler audio")

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
    chunk of the cold pre-greeting latency the caller would otherwise hear.

    Also warm DNS + TCP+TLS to the LLM and TTS providers so the first user
    turn of the first call doesn't pay a cold handshake.
    Best-effort: failures are silent (we'll just pay the cold cost on demand)."""
    try:
        proc.userdata["vad"] = silero.VAD.load()
    except Exception:
        # Non-fatal: the entrypoint falls back to a per-call VAD.load().
        pass

    # Warm Cartesia TTS endpoint (EU edge, latency-sensitive for each turn).
    try:
        import httpx as _httpx
        cartesia_url = os.getenv("CARTESIA_BASE_URL", "https://api.cartesia.ai")
        _httpx.get(f"{cartesia_url.rstrip('/')}/voices", timeout=3.0,
                   headers={"Authorization": f"Bearer {os.getenv('CARTESIA_API_KEY', 'x')}"})
    except Exception:
        pass

    # Resolve which LLM provider's endpoint to warm. Mirrors _llm_for's
    # defaults, honoring LLM_PROVIDER_FORCE for active A/B overrides.
    provider = (
        os.getenv("LLM_PROVIDER_FORCE", "").strip().lower()
        or os.getenv("LLM_PROVIDER", "deepseek").lower()
    )
    if provider == "deepseek":
        url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    elif provider == "openai":
        url = "https://api.openai.com/v1"
    elif provider == "anthropic":
        url = "https://api.anthropic.com/v1"
    else:
        url = None
    if url:
        try:
            import httpx as _httpx
            # /models is cheap, doesn't require auth on most providers, and
            # forces the full DNS + TCP + TLS path to complete. Even a 401 is
            # fine — the network round-trip is what we wanted.
            _httpx.get(f"{url.rstrip('/')}/models", timeout=3.0)
        except Exception:
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
