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
    load_script_by_id,
    load_target_context,
    rag_search,
    render_template,
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


def _lookup_twilio_call_sid(call_id: Optional[str]) -> Optional[str]:
    """Fetch the Twilio CallSid for an Axon call. Used by the hygiene
    watchdog so it can REST-end the Twilio leg the moment the agent decides
    to hang up — without this, SIP BYE propagation from LK Cloud to Twilio
    adds 8-12 seconds of dead silence on the patient's side.

    Reads BOTH the top-level twilio_call_sid column (legacy) and the
    metadata.twilio_call_sid path (where the deferred-stamp poll task
    actually writes it on the Agent-First flow). Without this fallback,
    Wati's +447359842582 case showed an 11s hangup billed by Twilio as
    172s — the SID was sitting in metadata, the lookup queried the empty
    top-level column, got NULL, and skipped the REST end-call.

    Returns None on any failure (the caller treats that as 'skip')."""
    if not call_id:
        return None
    try:
        from agent_config import _supabase_headers as _hdrs, _supabase_url as _url, has_supabase as _has
        if not _has():
            return None
        import httpx as _httpx
        with _httpx.Client(timeout=_httpx.Timeout(3.0), headers=_hdrs()) as c:
            r = c.get(_url(f"/rest/v1/calls?id=eq.{call_id}&select=twilio_call_sid,metadata"))
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return None
            row = rows[0]
            sid = row.get("twilio_call_sid")
            if not (isinstance(sid, str) and sid):
                meta = row.get("metadata") or {}
                if isinstance(meta, dict):
                    sid = meta.get("twilio_call_sid")
            return sid if isinstance(sid, str) and sid else None
    except Exception:
        return None


def _twilio_end_call(call_sid: str, clog: logging.LoggerAdapter, call_id: Optional[str] = None) -> None:
    """Force Twilio to mark a Call as completed.
    Posts to /api/agent-tools/end-twilio-call on the Next.js app, which is
    where Twilio creds actually live (the agent worker on LK Cloud has no
    TWILIO_ACCOUNT_SID/AUTH_TOKEN). This cuts the patient leg in <1s
    instead of waiting 8-12s for the SIP BYE to travel LK Cloud → Twilio.
    Never raises."""
    import os as _os
    base = (
        _os.getenv("NEXT_PUBLIC_APP_URL")
        or (f"https://{_os.getenv('VERCEL_URL')}" if _os.getenv("VERCEL_URL") else None)
    )
    token = _os.getenv("INTERNAL_AGENT_API_TOKEN")
    if not base or not token:
        clog.debug(
            "twilio_end_call: NEXT_PUBLIC_APP_URL or INTERNAL_AGENT_API_TOKEN not set"
        )
        try:
            from db_writes import append_call_event as _evt
            _evt(call_id, "twilio_rest_end", {
                "ok": False, "error": "no_app_url_or_token",
            })
        except Exception:
            pass
        return
    try:
        import httpx as _httpx
        url = f"{base.rstrip('/')}/api/agent-tools/end-twilio-call"
        with _httpx.Client(timeout=_httpx.Timeout(5.0)) as c:
            r = c.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"call_sid": call_sid},
            )
        ok = False
        try:
            data = r.json() if r.status_code < 500 else {}
            ok = bool(data.get("ok"))
        except Exception:
            data = {}
        if ok:
            clog.info("twilio_end_call: ended Twilio call sid=%s", call_sid)
        else:
            clog.warning(
                "twilio_end_call: proxy returned ok=false sid=%s status=%d body=%s",
                call_sid, r.status_code, (r.text or "")[:200],
            )
        try:
            from db_writes import append_call_event as _evt
            _evt(call_id, "twilio_rest_end", {
                "ok": ok,
                "proxy_status": r.status_code,
                "twilio_status_code": data.get("status_code"),
                "twilio_call_sid": call_sid,
            })
        except Exception:
            pass
    except Exception:
        clog.exception("twilio_end_call: proxy call failed (sid=%s)", call_sid)
        try:
            from db_writes import append_call_event as _evt
            _evt(call_id, "twilio_rest_end", {"ok": False, "error": "exception"})
        except Exception:
            pass


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
        anth_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY")
        if not anth_key:
            raise RuntimeError(
                "Anthropic selected but neither ANTHROPIC_API_KEY nor "
                "CLAUDE_API_KEY is set on the worker."
            )
        key_src = "ANTHROPIC_API_KEY" if os.getenv("ANTHROPIC_API_KEY") else "CLAUDE_API_KEY"
        logger.info(
            "LLM=anthropic model=%s key_src=%s key_len=%d key_prefix=%s max_tokens=%d",
            anth_model, key_src, len(anth_key), anth_key[:14], max_tokens,
        )
        return _build_llm_with_max_tokens(
            anthropic.LLM,
            max_tokens,
            model=anth_model,
            api_key=anth_key,
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
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OpenAI selected but OPENAI_API_KEY is not set on the worker.")
        oai_model = model if (model and model.startswith(("gpt", "o1", "o3", "o4", "chatgpt"))) else "gpt-4o-mini"
        logger.info("LLM=openai model=%s key_len=%d max_tokens=%d", oai_model, len(api_key), max_tokens)
        return _build_llm_with_max_tokens(
            openai.LLM,
            max_tokens,
            model=oai_model,
            api_key=api_key,
            client=_shared_openai_client("https://api.openai.com/v1", api_key),
        )

    # Default: DeepSeek (OpenAI-compatible, cheaper, no censorship issues for FR/EN calls)
    ds_model = model if (model and model.startswith("deepseek-")) else "deepseek-v4-flash"
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DeepSeek selected but DEEPSEEK_API_KEY is not set on the worker.")
    logger.info("LLM=deepseek model=%s key_len=%d max_tokens=%d", ds_model, len(api_key), max_tokens)
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
    # Default: u3-rt-pro is AssemblyAI's lowest-latency real-time model and
    # supports multilingual + continuous_partials + interruption_delay.
    # universal-streaming-* models are still selectable via env override.
    model = "u3-rt-pro"
    model = os.getenv("ASSEMBLYAI_MODEL", model)

    candidate: dict = {
        "model": model,
        # Wati June 10 v7 — force English-only on OCC prod. Wilma Taylor
        # said 'very good' in English; AssemblyAI multilingual mis-detected
        # 'muy bien' (Spanish) and 'A ver' (German) on the short utterances
        # because it has no English bias, so the agent replied 'I only
        # speak English on this line' and lost the patient. UK prospection
        # is English-only — pinning the language eliminates the entire
        # class of language-detection misfires.
        "language_code": os.getenv("ASSEMBLYAI_LANGUAGE", "en"),
        # The LiveKit Cloud agent runs in eu-central. AssemblyAI's default
        # endpoint is US — route to their EU streaming endpoint to cut
        # ~100-200ms of cross-Atlantic RTT off every transcription.
        # Override via ASSEMBLYAI_BASE_URL if a different geo is needed.
        "base_url": os.getenv(
            "ASSEMBLYAI_BASE_URL", "wss://streaming.eu.assemblyai.com"
        ),
        "end_of_turn_confidence_threshold": float(
            os.getenv("ASSEMBLYAI_EOT_THRESHOLD", "0.3")
        ),
        "min_turn_silence": int(os.getenv("ASSEMBLYAI_MIN_TURN_SILENCE", "100")),
        # Skip the formatted-final pass (punctuation/casing). It adds ~1s of
        # end-of-turn latency for zero benefit — the LLM reads raw text fine.
        # Override with ASSEMBLYAI_FORMAT_TURNS=true if a clean transcript is
        # needed for CRM/recording.
        "format_turns": os.getenv("ASSEMBLYAI_FORMAT_TURNS", "false").lower()
        in ("1", "true", "yes"),
        # Hard cap on how long AssemblyAI may wait before forcing a turn end,
        # even when it isn't fully confident. Bounds worst-case STT-delay.
        "max_turn_silence": int(os.getenv("ASSEMBLYAI_MAX_TURN_SILENCE", "400")),
    }
    # u3-rt-pro exclusives: continuous_partials + interruption_delay improve
    # responsiveness (faster commit on short answers + lower barge-in cost).
    if model == "u3-rt-pro":
        candidate["continuous_partials"] = True
        candidate["interruption_delay"] = int(os.getenv("ASSEMBLYAI_INTERRUPTION_DELAY", "200"))
    api_key = os.getenv("ASSEMBLYAI_API_KEY")
    if api_key:
        candidate["api_key"] = api_key
    else:
        # Make the missing-key state painfully obvious in the logs so we
        # don't waste a redeploy cycle debugging a typo or stale secret.
        related = sorted(k for k in os.environ if "ASSEMBLY" in k.upper())
        logger.error(
            "ASSEMBLYAI_API_KEY not visible on worker. "
            "len(os.getenv)=%d, related env keys present=%s, all env key count=%d",
            len(os.environ.get("ASSEMBLYAI_API_KEY") or ""),
            related,
            len(os.environ),
        )

    try:
        supported = set(inspect.signature(assemblyai.STT.__init__).parameters)
    except (ValueError, TypeError):
        supported = {"model"}
    kwargs = {k: v for k, v in candidate.items() if k in supported}

    # Progressive fallback: some kwargs are rejected at runtime by certain
    # plugin/model combinations (not caught by the signature filter, which
    # only checks names — not param/value validity). Try the full config,
    # then degrade to the safest minimal config, logging each failure so the
    # exact cause is visible in the call logs.
    attempts = [
        ("full", kwargs),
        ("model+key", {k: v for k, v in kwargs.items() if k in ("model", "api_key")}),
        ("key-only", {k: v for k, v in kwargs.items() if k == "api_key"}),
    ]
    last_exc: Optional[Exception] = None
    for label, attempt_kwargs in attempts:
        try:
            stt = assemblyai.STT(**attempt_kwargs)
            if label != "full":
                logger.warning(
                    "AssemblyAI STT built with reduced config '%s' (dropped: %s)",
                    label,
                    sorted(set(kwargs) - set(attempt_kwargs)),
                )
            return stt
        except Exception as e:  # noqa: BLE001
            last_exc = e
            logger.error(
                "AssemblyAI STT attempt '%s' failed: %s: %s (kwargs=%s)",
                label,
                type(e).__name__,
                e,
                sorted(attempt_kwargs),
            )
    # All attempts failed — re-raise the last error for the caller to log.
    assert last_exc is not None
    raise last_exc


def _tts_for(agent: Optional[AxonAgent], sample_rate: Optional[int] = None) -> cartesia.TTS:
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
        or os.getenv("CARTESIA_MODEL", "sonic-3.5")
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
    # Native telephony rendering (Wati 2026-06-12: Charlotte sounds "more
    # AI" on calls than in the browser simulation). The phone leg is 8kHz
    # G.711; asking Cartesia to synthesize AT 8kHz lets the model shape
    # the narrowband output instead of us brutally downsampling 44.1kHz
    # audio. Per-campaign via metadata.tts_sample_rate, signature-filtered
    # like everything else.
    if sample_rate:
        candidate["sample_rate"] = int(sample_rate)
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


def _build_save_contact_tool(
    contact_id: Optional[str],
    org_id: Optional[str],
    data_table: Optional[str] = None,
    data_row_id: Optional[str] = None,
    call_id: Optional[str] = None,
):
    """function_tool that lets the agent persist what it learns mid-call.

    Two write targets:
      • Data-table mode (campaign sourced from a real table like leads_rdv):
        writes to that physical table's row by real column names.
      • Otherwise: writes to the generic contacts row (attributes jsonb).

    Bound to THIS call's ids, so the LLM never handles an id — it just calls
    save_contact_data with the fields it collected. Returns None when there's
    nothing to write to (manual/simulation calls).
    """
    from livekit.agents import function_tool
    from db_writes import save_contact_data as _save_contact
    from db_writes import save_to_data_table as _save_table
    from db_writes import emit_qualification_webhooks as _emit_webhooks
    from db_writes import update_call_metadata as _upd_call_meta

    use_table = bool(data_table and data_row_id)
    if not use_table and not contact_id:
        return None

    @function_tool
    async def save_contact_data(
        fields_json: str,
        display_name: str = "",
        email: str = "",
        notes: str = "",
    ) -> str:
        """Persist structured data you collected about the patient onto their
        CRM record. Call this as soon as you have confirmed values — don't wait
        until the end of the call. Safe to call multiple times; fields merge.

        Args:
            fields_json: A JSON object of field→value pairs to save. Use the
                field keys defined for this campaign, e.g.
                {"bmi": 42, "poids": 120, "taille": 169, "qualification": "eligible",
                 "nhs_wmp_status": "tier3", "patient_dob": "1985-04-12",
                 "allergies": "penicillin", "current_medications": "metformin"}.
                Numbers as numbers, dates as YYYY-MM-DD strings.
            display_name: Optional — the patient's full name if newly confirmed.
            email: Optional — the patient's email if newly confirmed.
            notes: Optional — a short free-text note to append about this call.
        """
        import json as _json
        try:
            fields = _json.loads(fields_json) if fields_json else {}
            if not isinstance(fields, dict):
                return "Error: fields_json must be a JSON object."
        except Exception as e:
            return f"Error: invalid JSON ({e})."
        # Fold the convenience args into the field map (real-column names).
        if display_name:
            fields.setdefault("nom", display_name)
        if email:
            fields.setdefault("email", email)
        if notes:
            fields.setdefault("note", notes)

        # Race-safety against the idle watchdog. Bump save_in_flight so
        # the watchdog defers its hangup decision while we PATCH leads_rdv.
        # Without this, a 20s idle that lands exactly mid-HTTP can cancel
        # the asyncio.to_thread call and silently drop the lead update.
        _hyg = _HYGIENE_STATES.get(call_id or "") if call_id else None
        if isinstance(_hyg, dict):
            _hyg["save_in_flight"] = int(_hyg.get("save_in_flight", 0)) + 1
        try:
            if use_table:
                result = await asyncio.to_thread(_save_table, data_table, data_row_id, fields)
                # _save_table writes directly to the tenant's leads_rdv-style
                # table, but doesn't mirror the qualification to
                # calls.metadata.qualification the way the contacts path
                # does. Without this the dashboard bucketed every save
                # as 'AUTRE' even when Victoria's close stamped
                # qualification='RDV CONFIRME' on the lead row. Mirror it
                # ourselves so both views agree.
                qual_in_fields = fields.get("qualification") if isinstance(fields, dict) else None
                if result.get("ok") and qual_in_fields and call_id:
                    try:
                        await asyncio.to_thread(
                            _upd_call_meta,
                            call_id,
                            {
                                "qualification": str(qual_in_fields),
                                "qualification_source": "save_contact_data",
                            },
                        )
                    except Exception:
                        logger.exception(
                            "save_contact_data: mirror qualification to call failed (call=%s)",
                            call_id,
                        )
            else:
                result = await asyncio.to_thread(
                    _save_contact,
                    contact_id,
                    org_id,
                    fields,
                    display_name=display_name or None,
                    email=email or None,
                    notes=notes or None,
                    call_id=call_id,
                )
        finally:
            if isinstance(_hyg, dict):
                _hyg["save_in_flight"] = max(0, int(_hyg.get("save_in_flight", 1)) - 1)
        if result.get("ok"):
            # Notify any configured n8n webhooks (post-RDV Email/WhatsApp etc.)
            # the moment a watched column like `qualification` is written.
            try:
                await asyncio.to_thread(
                    _emit_webhooks, org_id, data_table, data_row_id, fields,
                )
            except Exception:  # never let telemetry break the call
                pass
            return f"Saved: {', '.join(result.get('saved', [])) or '(nothing new)'}."
        return f"Could not save: {result.get('error', 'unknown error')}."

    return save_contact_data


# ─── Agent wrapper that greets via TTS only ───────────────────────────────
class AxonVoiceAgent(Agent):
    def __init__(self, *, instructions: str, tools, greeting: str, llm=None, tts=None, stt=None, vad=None, sip_participant=None, greet_on_answer: bool = False, quick_ack: bool = False):
        # Per-agent llm/tts/stt/vad override the session defaults. This is what
        # makes a handoff actually CHANGE THE VOICE: update_agent() rebuilds the
        # activity from the new Agent's components, whereas reassigning
        # session.tts mid-session is cached and has no audible effect. Passing
        # None leaves the component inheriting from the session (initial agent).
        kwargs = {"instructions": instructions, "tools": tools}
        if llm is not None:
            kwargs["llm"] = llm
        if tts is not None:
            kwargs["tts"] = tts
        if stt is not None:
            kwargs["stt"] = stt
        if vad is not None:
            kwargs["vad"] = vad
        super().__init__(**kwargs)
        self._greeting = greeting
        # Optional reference to the SIP participant already resolved by the
        # entrypoint via ctx.wait_for_participant(). on_enter uses this to
        # poll sip.callStatus directly instead of relying on room events
        # whose names/semantics differ across LK SDK versions.
        self._sip_participant = sip_participant
        # Agent-First flow: when True, the next user speech (the patient's
        # "Hello?") is answered with the STATIC greeting instead of a
        # free-form LLM reply. Set by on_enter for SIP sessions, cleared
        # by the first-partial hook / on_user_turn_completed / the silence
        # timeout.
        self._pending_first_greeting = False
        # Set when the greeting was already fired from a PARTIAL transcript
        # (see _fire_greeting_now) — on_user_turn_completed must still
        # suppress the LLM's reply to that first turn, otherwise the LLM
        # answers "Hello?" with a second, duplicate intro.
        self._suppress_first_llm_reply = False
        # Greeting mode (Wati 2026-06-12 A/B setup): production campaigns
        # keep the proven Wednesday flow (speech-first — wait for the
        # patient's first words, then greet). Campaigns explicitly opted
        # in via campaigns.metadata.greeting_mode = "on_answer" (or the
        # GREETING_ON_ANSWER_CAMPAIGN_IDS env list) get the experimental
        # greet-the-moment-the-SIP-answers flow, currently being tuned on
        # the "teste summer" campaign only.
        self._greet_on_answer = bool(greet_on_answer)
        # Quick-ack (Wati 2026-06-12, Randy Chipungu case): DeepSeek's TTFT
        # occasionally spikes to 5-10s, leaving the patient in dead air
        # after they speak ("Speaking." → 13s silence → watchdog hangup).
        # When enabled, every completed user turn after the greeting gets
        # an INSTANT canned acknowledgment ("Mm-hmm." / "Right.") spoken
        # while the LLM generates the real reply behind it — the same
        # trick Retell uses. The framework queues speech sequentially, so
        # the ack plays first and the LLM reply follows seamlessly.
        self._quick_ack = bool(quick_ack)
        self._ack_phrases = ["Mm-hmm.", "Right.", "Okay."]

    async def _say_regreet(self) -> None:
        # Speak the greeting again — used when the first one almost surely
        # played into in-band ringback before the patient picked up.
        import time as _t
        _b = _t.monotonic()
        logger.info("greeting: re-greet say() begin")
        try:
            await self.session.say(text=self._greeting, allow_interruptions=True)
            logger.info("greeting: re-greet say() returned in %.2fs", _t.monotonic() - _b)
        except Exception:
            logger.info(
                "greeting: re-greet interrupted after %.2fs (likely hangup)",
                _t.monotonic() - _b,
            )

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        # Dual purpose: in speech-first mode (production) this is THE
        # greeting trigger — patient's first turn completes, we speak the
        # canned greeting and suppress the LLM reply (v13 flow). In
        # on-answer mode (test campaigns) it's the re-greet fallback for
        # carriers that only emit final transcripts.
        if self._pending_first_greeting:
            self._pending_first_greeting = False
            logger.info(
                "greeting: firing from turn-completed (%s mode)",
                "on-answer" if self._greet_on_answer else "speech-first",
            )
            self._suppress_first_llm_reply = True
            asyncio.create_task(self._say_regreet())
        # Suppress the LLM's free-form reply when the re-greet IS the reply
        # — without this the LLM answers "Hello?" with a duplicate intro.
        if self._suppress_first_llm_reply:
            self._suppress_first_llm_reply = False
            from livekit.agents import StopResponse
            raise StopResponse()

        # Quick-ack: instant canned filler while the LLM thinks. Only on
        # turns that WILL get an LLM reply (we didn't suppress above), and
        # only when the campaign opted in (test campaign for now).
        if self._quick_ack:
            import random as _rnd
            phrase = _rnd.choice(self._ack_phrases)

            async def _say_ack() -> None:
                try:
                    # add_to_chat_ctx=False (when supported) keeps the
                    # filler out of the LLM's context so it doesn't start
                    # mimicking its own backchannel.
                    import inspect as _ins
                    say_params = set(_ins.signature(self.session.say).parameters)
                    kwargs = {"allow_interruptions": True}
                    if "add_to_chat_ctx" in say_params:
                        kwargs["add_to_chat_ctx"] = False
                    await self.session.say(text=phrase, **kwargs)
                except Exception:
                    logger.debug("quick-ack say failed", exc_info=True)

            asyncio.create_task(_say_ack())

    async def on_enter(self) -> None:
        # MARKER v13-canned-first-2026-06-10 — patient's first utterance is
        # answered with the static greeting (LLM reply suppressed via
        # StopResponse); free-form LLM takes over from turn 2.
        logger.info("on_enter: marker v13-canned-first-2026-06-10 active")
        if not self._greeting:
            return
        import time as _t
        # ────────────────────────────────────────────────────────────────
        # Wait for the SIP participant's sip.callStatus to reach "active"
        # (= patient answered, audio bidirectional). We poll the
        # participant reference passed in at construction time — that's
        # the same one the entrypoint resolved via ctx.wait_for_participant(),
        # so it's guaranteed present even when room.remote_participants
        # lags.
        #
        # Sessions WITHOUT a SIP participant (browser / desk) get
        # sip_participant=None and skip the gate entirely.
        max_gate = float(os.getenv("GREETING_SIP_GATE_TIMEOUT_SECONDS", "45.0"))
        gate_start = _t.monotonic()
        sp = self._sip_participant

        if sp is None:
            logger.info("greeting: no SIP participant injected — non-SIP session, skipping gate")
        else:
            # Diagnostic: log the participant's initial state once so we can
            # tell at a glance whether sip.callStatus updates ever arrive.
            try:
                initial_attrs = dict(getattr(sp, "attributes", None) or {})
                logger.info(
                    "greeting: SIP gate engaged, participant identity=%s initial callStatus=%r initial keys=%s",
                    getattr(sp, "identity", "?"),
                    initial_attrs.get("sip.callStatus"),
                    sorted(initial_attrs.keys()),
                )
            except Exception:
                pass

            last_logged_status: str | None = None
            while _t.monotonic() - gate_start < max_gate:
                try:
                    attrs = dict(getattr(sp, "attributes", None) or {})
                    status = (attrs.get("sip.callStatus") or "").lower()
                    if status != last_logged_status:
                        logger.info(
                            "greeting: SIP gate poll callStatus=%r at %.2fs",
                            status,
                            _t.monotonic() - gate_start,
                        )
                        last_logged_status = status
                    if status == "active":
                        logger.info(
                            "greeting: SIP gate released (callStatus=active) after %.2fs",
                            _t.monotonic() - gate_start,
                        )
                        break
                    # Some LK SIP outbound flows omit the explicit "active"
                    # transition and just clear the dialing/ringing flag.
                    # If status leaves dialing/ringing/automation but isn't
                    # "active", treat it as ready too.
                    if status and status not in {"dialing", "ringing", "automation"}:
                        logger.info(
                            "greeting: SIP gate released (callStatus=%r) after %.2fs",
                            status,
                            _t.monotonic() - gate_start,
                        )
                        break
                except Exception:
                    logger.debug("greeting: poll failed", exc_info=True)
                await asyncio.sleep(0.2)
            else:
                logger.warning(
                    "greeting: SIP gate timed out at %.1fs with last status=%r — greeting anyway",
                    max_gate,
                    last_logged_status,
                )

        # ────────────────────────────────────────────────────────────────
        # GREET-ON-ANSWER (Wati 2026-06-12: "il faut qu'il dit son greeting
        # au moment où la personne décroche").
        #
        # History: v13 waited for the patient's first word before greeting,
        # because on UK mobile routes callStatus='active' fires while the
        # carrier still plays IN-BAND ringback. But waiting cost 3-12s of
        # dead air on every normal pickup (Summer's test: "Hello" at 0:07,
        # agent at 0:19) — patients repeat "Hello? Hello?" and hang up.
        #
        # New flow:
        #   1. The moment the SIP gate releases (callStatus=active), say
        #      the greeting. Normal pickups hear it INSTANTLY.
        #   2. Ringback-swallowed case: if the patient's first speech
        #      arrives suspiciously LATE after the greeting finished
        #      (> REGREET_WINDOW, default 4s), the greeting almost surely
        #      played into ringback before they picked up — re-greet once,
        #      and suppress the LLM reply to that turn (the re-greet IS
        #      the reply).
        #   3. If the patient replies within the window ("yes, speaking"),
        #      it's a real answer to the greeting — the LLM takes over
        #      normally.
        # Silent pickups / voicemail are still handled by the existing
        # watchdog (NO_SPEECH_HANGUP_SECS) + voicemail STT detector.
        if sp is not None and self._greet_on_answer:
            # ── EXPERIMENTAL on-answer flow (test campaigns only) ──
            preroll = float(os.getenv("GREETING_PREROLL_SECONDS", "0.4"))
            if preroll > 0:
                await asyncio.sleep(preroll)
            _b = _t.monotonic()
            logger.info("greeting: say() begin (on-answer)")
            try:
                await self.session.say(text=self._greeting, allow_interruptions=True)
                logger.info("greeting: say() returned in %.2fs", _t.monotonic() - _b)
            except Exception:
                logger.info(
                    "greeting: say() interrupted after %.2fs (likely hangup)",
                    _t.monotonic() - _b,
                )
            greeting_done_at = _t.monotonic()
            regreet_window = float(os.getenv("GREETING_REGREET_WINDOW_SECONDS", "4.0"))
            self._pending_first_greeting = True  # armed = re-greet possible

            try:
                import re as _re_g
                _has_word = _re_g.compile(r"[a-zA-Z]{2,}")

                def _on_first_speech(ev) -> None:
                    if not self._pending_first_greeting:
                        return
                    txt = str(getattr(ev, "transcript", "") or "").strip()
                    # Skip pure noise/digit partials ("5.", "...") — they
                    # false-triggered the June 12 morning test.
                    if not _has_word.search(txt):
                        return
                    elapsed = _t.monotonic() - greeting_done_at
                    self._pending_first_greeting = False
                    if elapsed > regreet_window:
                        # First speech long after the greeting ended →
                        # greeting played into ringback, patient never
                        # heard it. Re-greet now.
                        logger.info(
                            "greeting: first speech %.1fs after greeting end — re-greeting (ringback suspected)",
                            elapsed,
                        )
                        self._suppress_first_llm_reply = True
                        asyncio.create_task(self._say_regreet())
                    else:
                        logger.info(
                            "greeting: patient replied %.1fs after greeting — LLM takes over",
                            elapsed,
                        )
                self.session.on("user_input_transcribed", _on_first_speech)
            except Exception:
                logger.debug("greeting: first-speech hook unavailable", exc_info=True)

            # Silent-pickup re-greet (Summer's June 12 test: the greeting
            # played into ringback, she picked up and stayed silent —
            # nothing re-triggered and the watchdog killed the call). If
            # no qualifying speech disarms the flag within the silence
            # window, re-greet once proactively.
            silence_regreet = float(os.getenv("GREETING_SILENT_REGREET_SECONDS", "5.0"))
            async def _silent_regreet() -> None:
                await asyncio.sleep(silence_regreet)
                if not self._pending_first_greeting:
                    return
                logger.info(
                    "greeting: no speech %.0fs after on-answer greeting — proactive re-greet",
                    silence_regreet,
                )
                # Keep the flag armed: a later first-speech can still
                # decide LLM-takeover vs another re-greet via the hook.
                await self._say_regreet()
            asyncio.create_task(_silent_regreet())
            return

        if sp is not None:
            # ── PRODUCTION speech-first flow (Wednesday June 10 v13) ──
            # Wait for the patient's first words; the greeting is fired by
            # on_user_turn_completed (which also suppresses the LLM's
            # duplicate reply). On timeout leave the interceptor armed for
            # late pickups — in-band ringback means callStatus='active'
            # fires long before the handset actually rings.
            self._pending_first_greeting = True
            speech_wait = float(os.getenv("GREETING_WAIT_FOR_SPEECH_SECONDS", "45.0"))
            speech_start = _t.monotonic()
            while self._pending_first_greeting and _t.monotonic() - speech_start < speech_wait:
                await asyncio.sleep(0.25)
            if not self._pending_first_greeting:
                logger.info(
                    "greeting: first turn intercepted after %.2fs — static greeting handled by interceptor",
                    _t.monotonic() - speech_start,
                )
                return
            logger.warning(
                "greeting: no speech within %.0fs — leaving interceptor armed "
                "for late pickup (in-band ringback suspected)",
                speech_wait,
            )
            return

        # Static greeting path: non-SIP sessions (desk/browser) and the
        # silent-pickup timeout. Tiny pre-roll so the first syllable isn't
        # clipped.
        preroll = float(os.getenv("GREETING_PREROLL_SECONDS", "0.3"))
        if preroll > 0:
            await asyncio.sleep(preroll)
        _b = _t.monotonic()
        logger.info("greeting: say() begin")
        try:
            await self.session.say(text=self._greeting, allow_interruptions=True)
            logger.info("greeting: say() returned in %.2fs", _t.monotonic() - _b)
        except Exception:
            logger.info(
                "greeting: say() interrupted after %.2fs (likely hangup)",
                _t.monotonic() - _b,
            )


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


# Per-call mutable state shared between _install_call_hygiene (which owns
# the idle watchdog) and the save_contact_data tool closure (which lives
# in a separate scope and needs to bump save_in_flight to block hangups
# during HTTP writes). Keyed by call_id; cleaned up at shutdown.
_HYGIENE_STATES: dict[str, dict] = {}


_LANG_NAMES = {
    "fr": "français", "en": "English", "es": "español", "de": "Deutsch",
    "it": "italiano", "pt": "português", "nl": "Nederlands",
}

_QUICK_ACK_BY_LANG = {
    "fr": "Commence chaque réponse par un mot court (Oui, D'accord, Bien sûr, Hmm), puis la réponse.",
    "en": "Start each reply with a short word (Yes, Sure, Okay, Hmm), then the answer.",
    "es": "Comienza cada respuesta con una palabra corta (Sí, Claro, Vale, Hmm), luego la respuesta.",
    "de": "Beginne jede Antwort mit einem kurzen Wort (Ja, Klar, Okay, Hmm), dann die Antwort.",
    "it": "Inizia ogni risposta con una parola breve (Sì, Certo, Va bene, Hmm), poi la risposta.",
    "pt": "Comece cada resposta com uma palavra curta (Sim, Claro, Tá, Hmm), depois a resposta.",
}


def _lang_code_for(axon) -> str:
    return (axon.language if axon and getattr(axon, "language", None) else "").lower()


def _apply_language_lock(instructions: str, axon) -> str:
    """Append a strict language directive when the persona has a declared
    language. Stops the LLM from following STT-misread language hints
    (the EN → DE → FR drift seen in production)."""
    code = _lang_code_for(axon)
    if code not in _LANG_NAMES:
        return instructions
    label = _LANG_NAMES[code]
    return (
        f"{instructions}\n\n"
        f"RÈGLE ABSOLUE DE LANGUE : tu réponds EXCLUSIVEMENT en {label}, "
        f"sans aucune exception. Si tu entends une autre langue, demande "
        f"poliment à l'interlocuteur de continuer en {label}. "
        f"Ne traduis jamais, ne mélange jamais les langues, même si le "
        f"transcript semble suggérer une autre langue."
    )


def _quick_ack_directive(axon) -> str:
    code = _lang_code_for(axon)
    return _QUICK_ACK_BY_LANG.get(code, _QUICK_ACK_BY_LANG["fr"])


def _assemble_agent_runtime(
    axon: AxonAgent,
    *,
    template_vars: dict,
    ctx: JobContext,
    save_contact_id,
    save_org_id,
    save_table,
    save_row,
    call_id: Optional[str] = None,
):
    """Build (instructions, greeting, tools) for one agent persona, rendered
    with the call's template vars and bound to the call's write-back target.

    Reused at session start AND on every handoff, so a swapped-in agent gets
    its OWN system prompt + greeting + tools (transfer_to_specialist,
    save_contact_data, n8n, RAG) — not merely a new voice.
    """
    instructions = axon.system_prompt or (
        "Tu es un assistant vocal multilingue. Sois concis et conversationnel."
    )
    if axon.voice_style:
        instructions = (
            f"{instructions}\n\nStyle et ton à adopter : {axon.voice_style}. "
            "Reste naturel et conversationnel."
        )
    instructions = _apply_language_lock(instructions, axon)
    if os.getenv("QUICK_ACK", "true").lower() not in ("false", "0", "no"):
        instructions = f"{instructions}\n{_quick_ack_directive(axon)}"
    instructions = render_template(instructions, template_vars)
    greeting = render_template(axon.greeting or "", template_vars)

    tools: list = []
    try:
        tools.extend(_build_n8n_tools(axon))
    except Exception:
        logger.exception("handoff: n8n tools build failed")
    if axon.rag_enabled:
        try:
            tools.append(_build_rag_tool(axon))
        except Exception:
            logger.exception("handoff: rag tool build failed")
    save_tool = _build_save_contact_tool(
        save_contact_id, save_org_id, save_table, save_row, call_id=call_id,
    )
    if save_tool is not None:
        tools.append(save_tool)
    try:
        t = build_transfer_tool(axon.id, ctx.room)
        if t is not None:
            tools.append(t)
    except Exception:
        logger.exception("handoff: transfer tool build failed")
    try:
        h = build_handoff_to_handle_tool(ctx.room)
        if h is not None:
            tools.append(h)
    except Exception:
        logger.exception("handoff: handoff_to_handle tool build failed")
    return instructions, greeting, tools


def _install_team_handoff_watcher(
    ctx: JobContext,
    session: AgentSession,
    *,
    template_vars: dict,
    save_contact_id,
    save_org_id,
    save_table,
    save_row,
    clog,
    call_id: Optional[str] = None,
) -> None:
    """Watch room metadata for `handoff_to` and FULLY swap the running agent
    (prompt + greeting + tools + LLM + TTS) to the requested sibling.

    This is what makes the Charlotte → Isabelle → Victoria journey actually
    behave like three different agents on a real call, each writing back to
    the same patient row.
    """
    state = {"seen": handoff_target_from_metadata(ctx.room.metadata), "busy": False}

    async def _do_swap(target_agent_id: str) -> None:
        try:
            axon_next = await asyncio.to_thread(load_agent, target_agent_id)
        except Exception:
            clog.exception("handoff: failed to load agent %s", target_agent_id)
            return
        if not axon_next:
            clog.warning("handoff: agent %s not found", target_agent_id)
            return
        instr, greet, tools = _assemble_agent_runtime(
            axon_next,
            template_vars=template_vars,
            ctx=ctx,
            save_contact_id=save_contact_id,
            save_org_id=save_org_id,
            save_table=save_table,
            save_row=save_row,
            call_id=call_id,
        )
        try:
            next_llm = _llm_for(axon_next)
            next_tts = _tts_for(axon_next)
            # Belt-and-suspenders: also set on the session (no-op on some
            # versions, but harmless). The authoritative swap is the per-agent
            # tts/llm passed into the new Agent below.
            try:
                session.llm = next_llm
                session.tts = next_tts
            except Exception:
                pass
            # livekit-agents 1.5.x: session.update_agent(...) is synchronous and
            # returns None. Earlier versions returned a coroutine, so we accept
            # both shapes here. Wrapping unconditionally with `await` raises
            # `TypeError: object NoneType can't be used in 'await' expression`
            # and breaks the Charlotte → Isabelle handoff.
            _ret = session.update_agent(
                AxonVoiceAgent(
                    instructions=instr, tools=tools, greeting=greet,
                    llm=next_llm, tts=next_tts,
                )
            )
            if asyncio.iscoroutine(_ret):
                await _ret
            clog.info(
                "handoff: FULL swap -> %s (%s) voice=%s model=%s, %d tools",
                axon_next.id, axon_next.name, axon_next.tts_voice_id, axon_next.llm_model, len(tools),
            )
            # Safety net (Wati 2026-06-12, Marina Gorton): update_agent()
            # should trigger the new agent's on_enter → say(greeting), but
            # on Marina's call Isabelle stayed silent for 23s after the
            # swap until the idle watchdog killed the line — the patient
            # was told "stay on the line" and got dead air. Whatever the
            # root cause (lost on_enter, TTS hiccup), the recovery is the
            # same: if the swapped agent hasn't produced any speech 3s
            # after the swap, say its greeting directly on the session.
            _greet_for_net = greet

            async def _ensure_greeted() -> None:
                try:
                    await asyncio.sleep(3.0)
                    st = ""
                    try:
                        st = str(getattr(session, "agent_state", "") or "").lower()
                    except Exception:
                        pass
                    import time as _t_net
                    _hyg2 = _HYGIENE_STATES.get(call_id) if call_id else None
                    speaking_until = float(_hyg2.get("agent_speaking_until", 0) or 0) if _hyg2 else 0.0
                    agent_busy = (
                        st in ("speaking", "thinking")
                        or _t_net.monotonic() < speaking_until
                        or bool(_hyg2 and _hyg2.get("agent_active"))
                    )
                    if agent_busy:
                        return  # on_enter did its job — greeting is out
                    clog.warning(
                        "handoff: %s produced no speech 3s after swap — forcing greeting directly",
                        axon_next.name,
                    )
                    if _greet_for_net:
                        await session.say(text=_greet_for_net, allow_interruptions=True)
                except Exception:
                    clog.exception("handoff: ensure-greeted safety net failed")

            try:
                asyncio.create_task(_ensure_greeted())
            except RuntimeError:
                pass

            # Reset hygiene state so the new agent inherits a clean slate.
            # Charlotte's transition phrase ("I'm transferring you now, talk
            # soon") can match the goodbye regex and arm a 5s hangup timer —
            # without this reset, that timer fires DURING Isabelle's greeting
            # and the engine closes mid-TTS.
            if call_id:
                _hyg = _HYGIENE_STATES.get(call_id)
                if _hyg is not None:
                    import time as _t_hyg
                    _hyg["goodbye_armed_at"] = None
                    _hyg["last_agent_ts"] = _t_hyg.monotonic()
                    _hyg["last_user_ts"] = _t_hyg.monotonic()
            # Persist as a call_event so auto_qualify_call (and the dashboard
            # Chaîne d'agents widget) can count actual specialist handoffs
            # instead of guessing from duration alone. Best-effort: never
            # let a telemetry write break the live conversation.
            try:
                from db_writes import append_call_event as _evt
                _evt(call_id, "handoff_initiated", {
                    "to_agent_id": axon_next.id,
                    "to_agent_name": axon_next.name,
                })
            except Exception:
                clog.exception("handoff: failed to log call_event")
        except Exception:
            clog.exception("handoff: full swap failed")

    def _on_meta(*_a, **_k) -> None:
        target = handoff_target_from_metadata(ctx.room.metadata)
        if not target or target == state["seen"] or state["busy"]:
            return
        state["seen"] = target
        state["busy"] = True

        async def _run():
            try:
                await _do_swap(target)
            finally:
                state["busy"] = False

        try:
            asyncio.create_task(_run())
        except RuntimeError:
            state["busy"] = False

    # Primary path: in-process trigger. The transfer/handoff tools run in this
    # same worker, so they call our handler directly (room metadata written from
    # the worker doesn't propagate as ROOM metadata, so the event below often
    # never fires — this is what makes the swap actually happen).
    def _local_handoff(target_agent_id: str) -> None:
        if not target_agent_id or target_agent_id == state["seen"] or state["busy"]:
            return
        state["seen"] = target_agent_id
        state["busy"] = True

        async def _run():
            try:
                await _do_swap(target_agent_id)
            finally:
                state["busy"] = False

        try:
            asyncio.create_task(_run())
        except RuntimeError:
            state["busy"] = False

    try:
        from swarm import register_local_handoff_handler, unregister_local_handoff_handler
        register_local_handoff_handler(ctx.room.name, _local_handoff)
        clog.info("team handoff: in-process handler registered for room=%s", ctx.room.name)
        # Drop the registry entry when the call ends (long-lived worker).
        try:
            async def _unreg():
                unregister_local_handoff_handler(ctx.room.name)
            ctx.add_shutdown_callback(_unreg)
        except Exception:
            pass
    except Exception:
        clog.exception("team handoff: could not register in-process handler")

    # Secondary path (best-effort): also react to ROOM metadata changes, e.g.
    # a human handoff initiated from the desk via the server API.
    wired = False
    for name in ("metadata_changed", "room_metadata_changed"):
        try:
            ctx.room.on(name, _on_meta)
            wired = True
            break
        except Exception:
            continue
    if wired:
        clog.info("team handoff watcher installed (metadata fallback)")
    else:
        clog.warning("team handoff watcher: no metadata_changed event on this SDK")


def _install_call_hygiene(
    ctx: JobContext,
    session: AgentSession,
    clog,
    *,
    idle_timeout: float = 4.0,
    goodbye_grace: float = 2.0,
) -> None:
    """Hang up the call automatically to stop the meter when there's no
    point staying connected. Triggers:

      1. Idle: no user STT *and* no agent activity for `idle_timeout`
         seconds. "Agent activity" tracks BOTH `conversation_item_added`
         (when LLM output is committed) and `metrics_collected` (LLM-TTFT
         and TTS-TTFB), so we don't false-trigger while the agent is in
         the middle of a long TTS response (which can stream for 15-20s
         before the conversation_item event finalises).
      2. Goodbye: the agent says a clear closing phrase (regex matches
         "bye / take care / see you / au revoir / etc."). After TTS
         finishes plus `goodbye_grace` seconds of caller silence, we
         disconnect.

    Defaults raised to 30s for idle after OCC pilots showed Charlotte
    being cut mid-sentence on long explanations. Both thresholds are
    env-overridable via IDLE_HANGUP_SECONDS / GOODBYE_GRACE_SECONDS so we
    can tune in production without redeploying.
    """
    import time as _t
    idle_timeout = float(os.getenv("IDLE_HANGUP_SECONDS", str(idle_timeout)))
    goodbye_grace = float(os.getenv("GOODBYE_GRACE_SECONDS", str(goodbye_grace)))
    # In-conversation idle target. After the patient has spoken at least
    # once, LLM thinking + TTS startup latency routinely spans 3-7s of
    # silence even on a healthy session — staying at 5s cuts the agent
    # mid-thought. 10s is the agreed compromise: covers 95% of LLM
    # response times on this stack while adding only ~5s to the voicemail-
    # without-keywords / silent-after-greeting cases vs the pre-speech 5s.
    conversational_idle = float(
        os.getenv("CONVERSATIONAL_IDLE_HANGUP_SECONDS", "10.0"),
    )

    # Patterns that, when the AGENT says them, indicate the call is wrapping
    # up. Cover English (OCC primary), French, Spanish, German — same
    # language list as the language lock so OCC + EU campaigns are covered.
    import re as _re
    # NOTE: only phrases that *unambiguously* end the call. Soft transition
    # phrases ("talk soon", "speak soon", "see you", "we'll be in touch",
    # "catch you later", "cheers") are deliberately excluded because agents
    # use them during handoffs ("I'm transferring you now, talk soon") — if
    # they armed the hangup timer, it would fire mid-greeting of the next
    # specialist. Defense in depth: the handoff also resets goodbye_armed_at.
    _goodbye_re = _re.compile(
        r"\b("
        r"bye[\s,!.?-]*bye"
        r"|good\s*bye"
        r"|good\s*bye\s+for\s+now"
        r"|have\s+a\s+(great|good|nice|wonderful|lovely)\s+(day|evening|weekend|afternoon|night)"
        r"|cheerio"
        r"|toodle\s*oo"
        # French — both accented and unaccented because LLM transcripts /
        # voice agents routinely drop accents.
        r"|au\s*revoir"
        r"|[aà]\s*(bient[oô]t|bientot|plus\s*tard|tr[èe]s\s*vite|toute\s*[àa]\s*l[''](?:heure))"
        r"|bonne\s+(journ[ée]e|journee|soir[ée]e|soiree|fin\s+de\s+journ[ée]e|continuation)"
        r"|on\s+se\s+(rappelle|recontacte)"
        # Spanish
        r"|hasta\s+(luego|pronto|ma[ñn]ana|la\s+vista)"
        r"|adi[oó]s"
        r"|nos\s+vemos"
        # German
        r"|tsch[üu]ss"
        r"|auf\s+wiederh[öo]ren"
        r"|sch[öo]nen\s+tag"
        r"|bis\s+(bald|sp[äa]ter|morgen)"
        # Italian
        r"|arrivederci"
        r"|ciao"
        r")\b",
        _re.IGNORECASE,
    )

    # Voicemail / answering machine signature phrases. AMD on the Twilio side
    # filters most of these before they ever reach the bridge, but a smart
    # network's voicemail can answer fast enough to fool DetectMessageEnd, and
    # tenants who run AMD=off rely entirely on this hook. We match only on the
    # FIRST few seconds of STT — past that, real conversations can legitimately
    # mention "leave a message" etc. (e.g. patient saying "should I leave a
    # message with reception?") without triggering a false hangup.
    _voicemail_re = _re.compile(
        r"\b("
        r"voice\s*mail|leave\s+a\s+message|leave\s+your\s+(name|message)"
        r"|please\s+(record|leave)|after\s+the\s+(tone|beep|signal)"
        r"|recording\s+your\s+message|at\s+the\s+(tone|beep)"
        r"|i('?m|\s+am)\s+(not|unable)\s+(available|able\s+to\s+(take|answer))"
        r"|can(?:'?t|\s+not)\s+(take|come\s+to|answer)\s+(the|your|my)?\s*(call|phone)"
        r"|you('?ve|\s+have)\s+reached\s+the\s+(voicemail|message)"
        r"|sorry\s+i\s+(missed|can(?:'?t|\s+not)\s+(take|answer))"
        # Voicemail SYSTEM navigation prompts — Jeff Hollis's mailbox spent
        # 80s feeding these to Charlotte ("press hash when you're done",
        # "recording now", "to leave a message for someone else, press 2")
        # without ever matching the greeting-style patterns above.
        r"|press\s+(hash|pound|star|the\s+\w+\s+key|\d)\b"
        r"|recording\s+now|message\s+hasn'?t\s+been\s+saved"
        r"|to\s+(leave|re.?record|listen\s+to)\s+(a|your|the)\s+message"
        r"|when\s+you('?re|\s+are)\s+done"
        # Google Pixel Call Screening / iOS Live Voicemail / similar AI
        # call-screening assistants. Imi Rothon's call: "I'm a call
        # assistant recording this call for the person you're trying to
        # reach. Please say who you are." Charlotte then chatted with the
        # robot for 2 minutes. None of these phrases appear in a real
        # patient's first 10 s.
        r"|call\s+(assistant|screening)|screening\s+(this|your)\s+call"
        r"|recording\s+this\s+call|this\s+call\s+(is\s+being|may\s+be)\s+recorded"
        r"|the\s+person\s+(you('?re|\s+are)\s+(trying\s+to\s+reach|calling)|you('?ve|\s+have)\s+(reached|called))"
        r"|(?:please\s+)?(?:say|tell\s+me)\s+(who\s+you\s+are|your\s+name|the\s+purpose)"
        r"|what(?:'?s|\s+is)\s+(?:the\s+)?(?:purpose|reason)\s+(?:of|for)\s+(?:this|your)\s+call"
        r"|could\s+you\s+tell\s+me\s+(?:what|why|the\s+purpose)"
        r"|please\s+hold\s+while\s+i\s+(connect|transfer|forward)"
        r"|(?:the\s+person\s+you('?re|\s+are)\s+calling\s+is\s+busy|is\s+(?:currently\s+)?busy\s+(?:now|at\s+the\s+moment))"
        r"|google\s+(?:assistant|voice)|hey,?\s+who's\s+calling"
        # UK / Vodafone / EE / O2 / Three carrier announcements when the
        # destination is busy, off, ringing-out, or out of service. These
        # don't say "leave a message" but they're 100% deterministic — there
        # is no human at the end. Drop the call before Charlotte burns 20s
        # waiting for an answer.
        r"|(?:is\s+|currently\s+|line\s+|number\s+|are\s+)?busy(?:\s+at\s+the\s+moment|\s+right\s+now)?"
        r"|(?:please\s+)?try(?:\s+your\s+call)?\s+(?:again|later)"
        r"|cannot\s+be\s+(reached|connected|completed)"
        r"|(?:may\s+be\s+|is\s+)?(?:switched\s+off|powered\s+off|turned\s+off)"
        r"|(?:is\s+)?(?:not\s+)?(?:reachable|available|in\s+service|recognised|recognized|valid)"
        r"|no\s+longer\s+(?:in\s+service|available|exists|recognized|recognised)"
        r"|the\s+(?:number|person|party|mobile|line)\s+you\s+(?:are\s+calling|have\s+(?:dialed|dialled))"
        r"|number\s+(?:you('?ve|\s+have))?\s*dialed"
        r"|out\s+of\s+(?:service|range|coverage|the\s+(?:office|country))"
        r"|(?:please\s+)?(?:hang\s+up|redial)\s+and\s+try"
        r"|disconnected|temporarily\s+unavailable"
        # French (carrier-style)
        r"|messagerie|laisser\s+un\s+message|laissez\s+(un\s+message|votre\s+message)"
        r"|apr[èe]s\s+le\s+(bip|signal)|n'?est\s+pas\s+disponible"
        r"|vous\s+[êe]tes\s+sur\s+la\s+messagerie"
        r"|(?:est|sont)\s+occup[ée]e?s?|essayez\s+(?:de\s+nouveau|plus\s+tard|ult[ée]rieurement)"
        r"|correspondant\s+(?:n[\s']*est\s+pas\s+(?:joignable|disponible)|est\s+inaccessible)"
        r"|(?:hors\s+service|injoignable|pas\s+attribu[ée])"
        r")\b",
        _re.IGNORECASE,
    )

    # Window during which we accept STT-based voicemail detection, anchored
    # on the FIRST SPEECH heard. 20s (was 8s): UK mailboxes often read the
    # full phone number digit by digit ("7, 4, 7, 7, 8, 9…") before the
    # signature phrase, which burned the entire 8s window on Jeff Hollis's
    # mailbox. A real patient saying "leave a message" / "press hash" within
    # their first 20 seconds is implausible, so the wider window stays safe.
    # 10 s from FIRST SPEECH — Wati's spec: a voicemail call must not exceed
    # ~10 s total agent time. A real patient saying "leave a message" or
    # "press hash" inside their first 10 s is implausible, so the window
    # stays safe against false REPONDEUR on humans.
    voicemail_detect_window = float(os.getenv("VOICEMAIL_DETECT_WINDOW_SECS", "10.0"))

    # Distress / safety phrases that MUST trigger immediate handoff in a
    # healthcare context. We listen across the WHOLE call (not just the first
    # few seconds like voicemail) because a patient might disclose distress
    # mid-conversation. Matches are not fatal on their own — we let the agent
    # acknowledge the situation, schedule a human callback flagged URGENT,
    # then hang up cleanly.
    #
    # Two tiers:
    #   • _medical_emergency_re : medical or life-threat — Charlotte ALSO
    #     reminds the patient to call 999.
    #   • _distress_re : bereavement, family crisis, hospital — Charlotte
    #     acknowledges, schedules callback flagged URGENT, hangs up. No 999.
    #     Note: "can't talk now" used to live here, but it's a polite RAPPEL
    #     signal far more often than distress. We let the conversation handle
    #     a callback request normally and reserve distress for actual crises.
    _medical_emergency_re = _re.compile(
        r"\b("
        r"chest\s+pain|can(?:'?t|\s+not)\s+breathe|breathing\s+(?:problem|difficulty)"
        r"|heart\s+attack|stroke|seizure|unconscious|bleeding"
        r"|overdose|allergic\s+reaction|anaphyla"
        r"|suicid|self.?harm|kill\s+myself|end\s+my\s+life"
        r"|999|112|emergency\s+(?:room|services|ambulance)|A&E|accident\s+and\s+emergency"
        r"|douleur\s+(?:dans|à)\s+la\s+poitrine|crise\s+cardiaque|AVC"
        r"|n('?est|\s+est)\s+plus\s+conscient"
        r")\b",
        _re.IGNORECASE,
    )
    _distress_re = _re.compile(
        r"\b("
        r"(?:my|a)\s+(?:mum|mom|mother|dad|father|husband|wife|son|daughter|brother|sister|child|baby)\s+"
            r"(?:just\s+)?(?:died|passed\s+away|passed|is\s+dying)"
        r"|funeral|terminal\s+(?:illness|diagnos)|just\s+lost\s+(?:my|a)"
        r"|family\s+(?:emergency|crisis|tragedy)"
        r"|in\s+the\s+hospital|at\s+the\s+hospital|in\s+intensive\s+care|in\s+ICU"
        r"|(?:ma|mon)\s+(?:mère|père|mari|femme|fils|fille|frère|sœur|enfant|bébé)\s+"
            r"(?:est|vient\s+de|viens\s+de)\s+(?:mourir|décéd|partir)"
        r"|enterrement|obsèques"
        r")\b",
        _re.IGNORECASE,
    )

    state = {
        "last_user_ts": _t.monotonic(),
        "last_agent_ts": _t.monotonic(),
        "call_started_at": _t.monotonic(),
        "goodbye_armed_at": None,  # monotonic ts when goodbye phrase was detected
        "hung_up": False,
        # The agent is considered 'active' (speaking / thinking) while
        # session.agent_state is "speaking" or "thinking". The idle watchdog
        # skips its hangup check while the agent is active so a long TTS
        # turn (e.g. Charlotte explaining the NHS S2 pathway) can't be
        # cut off mid-sentence at the 5s idle threshold.
        "agent_active": False,
        # Two-mode watchdog. Before the patient has said anything, idle 5s
        # is a fast voicemail / no-answer / silent-pickup detector. Once
        # the patient has spoken at all the conversation is real and the
        # idle target jumps to `conversational_idle_secs` — LLM thinking
        # + TTS startup latency on the swarm path (Charlotte → Isabelle →
        # Victoria) routinely spans 5-12s after a user turn, and the
        # earlier 5s gate kept cutting the agent mid-thought.
        "user_has_spoken": False,
        # Agent First flow: the agent enters the room BEFORE the SIP
        # participant. on_enter blocks waiting for sip.callStatus=active.
        # During that wait the watchdog mustn't fire its 4s idle hangup
        # — it would tear the call down before the patient even
        # connects. Flip to True the moment the agent emits its first
        # assistant message (the greeting), which only happens after
        # on_enter releases its gate.
        "first_agent_turn": False,
        # Race-safety: save_contact_data writes to leads_rdv via HTTP. If the
        # idle timer fires WHILE that write is in flight, the asyncio.to_thread
        # call can be cancelled and the leads_rdv update silently lost. The
        # tool flips this counter around its call, and the watchdog refuses
        # to hang up while it's > 0.
        "save_in_flight": 0,
    }
    # Stash the state on the module-level map keyed by call_id so the
    # save_contact_data tool (built in a separate scope) can find it.
    cid = getattr(ctx, "_call_id", None)
    if cid:
        _HYGIENE_STATES[cid] = state

    async def _hangup(reason: str) -> None:
        if state["hung_up"]:
            return
        state["hung_up"] = True
        clog.info("call hygiene: hangup (%s)", reason)
        try:
            from db_writes import append_call_event as _evt
            cid = getattr(ctx, "_call_id", None)
            _evt(cid, "auto_hangup", {"reason": reason})
        except Exception:
            pass
        # Stamp an explicit qualification when the hangup reason carries one.
        # Without this, auto_qualify_call runs at session shutdown BEFORE the
        # Twilio status callback delivers the final CallDuration — duration is
        # 0 at that moment, so the heuristic mis-classifies a clearly detected
        # voicemail as PAS DE REPONSE. We pre-stamp REPONDEUR / A PASSER A
        # L'HUMAIN here so auto_qualify_call sees an explicit qualification
        # and skips its duration-based branching entirely.
        qualification_for_reason: Optional[str] = None
        # Match the STT-regex hangup specifically — the idle watchdog also
        # mentions "voicemail" in its catch-all reason ("idle 5s — likely
        # voicemail or dropped audio") and we MUST NOT auto-stamp REPONDEUR
        # on a real human who just stayed silent after the greeting. Only
        # the explicit voicemail STT detection writes REPONDEUR.
        reason_lower = reason.lower()
        if "voicemail detected via stt" in reason_lower:
            qualification_for_reason = "REPONDEUR"
            qualification_source_for_reason = "voicemail_stt"
        elif "distress detected" in reason_lower:
            qualification_for_reason = "A PASSER A L'HUMAIN"
            qualification_source_for_reason = "distress_detected"
        else:
            qualification_source_for_reason = None
        if qualification_for_reason:
            try:
                cid = getattr(ctx, "_call_id", None)
                if cid:
                    from db_writes import update_call_metadata as _upd_meta
                    await asyncio.to_thread(
                        _upd_meta,
                        cid,
                        {
                            "qualification": qualification_for_reason,
                            "qualification_source": qualification_source_for_reason,
                        },
                    )
            except Exception:
                clog.exception(
                    "auto_hangup: stamp qualification failed (call=%s)", cid,
                )
        # Force-end the call on Twilio's side too. SIP BYE from LK Cloud to
        # Twilio can take 8-12s to propagate, during which the patient's
        # phone is still 'connected' to dead silence — patient experience
        # 'why is this still on the line?' even though the agent left. The
        # Twilio REST update completes in <1s.
        try:
            _call_id_now = getattr(ctx, "_call_id", None)
            twilio_sid = await asyncio.to_thread(_lookup_twilio_call_sid, _call_id_now)
            if twilio_sid:
                await asyncio.to_thread(_twilio_end_call, twilio_sid, clog, _call_id_now)
        except Exception:
            clog.exception("auto_hangup: twilio end-call failed")
        # Stamp ended_at + duration at the REAL hangup moment. Without this
        # the row only gets ended_at at process shutdown — post-call work
        # (usage reporting, qualification, summary trigger) added 15-20s of
        # phantom duration (Hannah Clayton's voicemail: detection at t=28s,
        # ended_at written at t=48s, dashboard showed 0:45 for a call that
        # really lasted ~30s). finalize_call_state respects an existing
        # ended_at, so this wins.
        try:
            cid2 = getattr(ctx, "_call_id", None)
            if cid2:
                def _stamp_end(cid: str) -> None:
                    # Anchor duration on the row's started_at (INVITE time)
                    # so the displayed duration matches the Twilio recording.
                    # Wati's Frank Taylor case: agent-session clock said 0:26
                    # but the recording was 0:53 — the 27 s of ring were
                    # missing. Reading started_at here means we always include
                    # ring time, matching what the recording captures.
                    #
                    # CRITICAL: respect a pre-existing ended_at. The dialer
                    # already stamps ended_at when the SIP ring times out
                    # (Wati's June 10 "115 non-décrochés à 1:06" — without
                    # this guard the watchdog 60 s later would overwrite the
                    # real 10 s timeout with its own timestamp and inflate
                    # the displayed duration to 66 s.).
                    from datetime import datetime as _hdt, timezone as _htz
                    from db_writes import _supabase_headers as _sb_h, _supabase_url as _sb_u
                    import httpx as _hx
                    with _hx.Client(timeout=_hx.Timeout(5.0), headers=_sb_h()) as _c:
                        gr = _c.get(_sb_u(f"/rest/v1/calls?id=eq.{cid}&select=started_at,ended_at"))
                        started_iso = None
                        already_ended = None
                        try:
                            rows = gr.json() or []
                            if rows:
                                started_iso = rows[0].get("started_at")
                                already_ended = rows[0].get("ended_at")
                        except Exception:
                            pass
                        if already_ended:
                            # Someone (dialer ring timeout, Twilio webhook,
                            # earlier finalize) has stamped the real end —
                            # don't move it.
                            return
                        ended_dt = _hdt.now(_htz.utc)
                        dur = None
                        if started_iso:
                            try:
                                s = _hdt.fromisoformat(str(started_iso).replace("Z", "+00:00"))
                                dur = max(0, int((ended_dt - s).total_seconds()))
                            except Exception:
                                dur = None
                        body = {"ended_at": ended_dt.isoformat()}
                        if dur is not None:
                            body["duration_secs"] = dur
                        _c.patch(
                            _sb_u(f"/rest/v1/calls?id=eq.{cid}"),
                            headers={**_sb_h(), "Content-Type": "application/json", "Prefer": "return=minimal"},
                            json=body,
                        )

                await asyncio.to_thread(_stamp_end, cid2)
        except Exception:
            clog.exception("auto_hangup: ended_at stamp failed")
        # Politely end the room. delete_room would be the hard kill but
        # disconnect lets the session shut down cleanly and the post-call
        # pipeline run.
        try:
            await ctx.room.disconnect()
        except Exception:
            clog.exception("auto_hangup: ctx.room.disconnect() failed")

    # Low-confidence STT tracking — when AssemblyAI returns a transcript
    # with a low confidence score it usually means the patient has a strong
    # accent, is far from the mic, or the line is noisy. Two consecutive
    # low-confidence final turns trigger a polite "could you repeat that?"
    # instead of letting Charlotte plough on with a possibly-wrong intent.
    # Threshold is conservative (0.6) — most clean AssemblyAI Universal-2
    # turns sit above 0.85, accented but intelligible turns above 0.70.
    low_conf_threshold = float(os.getenv("STT_LOW_CONFIDENCE_THRESHOLD", "0.6"))
    state["low_conf_streak"] = 0

    def _on_user_speech(ev=None, *_a, **_k) -> None:
        state["last_user_ts"] = _t.monotonic()
        state["user_has_spoken"] = True
        # Patient is talking again — cancel any armed goodbye.
        state["goodbye_armed_at"] = None
        # Track final-turn confidence. Only `is_final` turns are stable
        # enough to act on; interims swing wildly. When we hit 2 lows in
        # a row, ask the patient to repeat (in a thread to avoid blocking
        # the STT callback) and reset the streak so we don't re-ask every
        # turn.
        try:
            is_final = bool(getattr(ev, "is_final", True)) if ev is not None else True
            confidence = (
                getattr(ev, "confidence", None) if ev is not None else None
            )
            if is_final and isinstance(confidence, (int, float)) and confidence > 0:
                if confidence < low_conf_threshold:
                    state["low_conf_streak"] = state.get("low_conf_streak", 0) + 1
                else:
                    state["low_conf_streak"] = 0
                if state["low_conf_streak"] >= 2 and not state["hung_up"]:
                    state["low_conf_streak"] = 0
                    clog.info(
                        "call hygiene: low STT confidence streak (last=%.2f) — asking patient to repeat",
                        float(confidence),
                    )

                    async def _ask_repeat() -> None:
                        try:
                            await session.say(
                                text="I'm sorry, the line isn't very clear — could you repeat that?",
                                allow_interruptions=True,
                            )
                        except Exception:
                            clog.debug("call hygiene: repeat prompt failed", exc_info=True)

                    asyncio.create_task(_ask_repeat())
        except Exception:
            clog.debug("call hygiene: confidence check failed", exc_info=True)
        # Distress / medical-emergency detection — runs on EVERY user turn
        # for the whole call, not just the voicemail window. A safety
        # hit fires once, then the flag prevents re-triggering.
        try:
            if not state.get("distress_handled") and not state["hung_up"]:
                text_for_distress = (
                    getattr(ev, "transcript", None) or getattr(ev, "text", None)
                    if ev is not None else None
                )
                if text_for_distress:
                    txt = str(text_for_distress)
                    is_medical = bool(_medical_emergency_re.search(txt))
                    is_distress = is_medical or bool(_distress_re.search(txt))
                    if is_distress:
                        state["distress_handled"] = True
                        clog.warning(
                            "call hygiene: %s detected via STT: %r",
                            "medical_emergency" if is_medical else "distress",
                            txt[:160],
                        )

                        async def _safe_exit() -> None:
                            # 1. Acknowledge + ALWAYS reference 999 if medical.
                            try:
                                if is_medical:
                                    msg = (
                                        "I'm really sorry to hear that. Please "
                                        "call 999 right now if you need urgent "
                                        "help. I'll have someone from our team "
                                        "call you back as soon as possible."
                                    )
                                else:
                                    msg = (
                                        "I'm so sorry to hear that. I won't "
                                        "keep you on the line — I'll have "
                                        "someone from our team call you back "
                                        "at a better time. Take care."
                                    )
                                await session.say(text=msg, allow_interruptions=False)
                            except Exception:
                                clog.debug("safe_exit: say failed", exc_info=True)
                            # 2. Log a structured event so we can audit these.
                            try:
                                from db_writes import append_call_event as _evt
                                cid = getattr(ctx, "_call_id", None)
                                _evt(
                                    cid,
                                    "distress_detected",
                                    {
                                        "tier": "medical_emergency" if is_medical else "distress",
                                        "snippet": txt[:200],
                                    },
                                )
                            except Exception:
                                clog.exception("safe_exit: distress event log failed")
                            # 3. Schedule URGENT human callback so a real
                            #    person follows up the same day.
                            try:
                                base_url = (
                                    os.getenv("NEXT_PUBLIC_APP_URL")
                                    or (f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else None)
                                )
                                token = os.getenv("INTERNAL_AGENT_API_TOKEN")
                                cid = getattr(ctx, "_call_id", None)
                                if base_url and token and axon and getattr(axon, "org_id", None):
                                    import httpx as _httpx
                                    payload = {
                                        "org_id": axon.org_id,
                                        "contact_id": (axon.contact.get("id") if getattr(axon, "contact", None) else None),
                                        "original_call_id": cid,
                                        "qualification": "A PASSER A L'HUMAIN",
                                        "reason": (
                                            "URGENT: "
                                            + ("medical/safety distress" if is_medical else "patient distress / bereavement")
                                            + " detected during call. Snippet: "
                                            + txt[:160]
                                        ),
                                    }
                                    try:
                                        async with _httpx.AsyncClient(timeout=_httpx.Timeout(5.0)) as hc:
                                            await hc.post(
                                                f"{base_url.rstrip('/')}/api/agent-tools/transfer-to-human",
                                                headers={
                                                    "Authorization": f"Bearer {token}",
                                                    "Content-Type": "application/json",
                                                },
                                                json=payload,
                                            )
                                    except Exception:
                                        clog.exception("safe_exit: transfer-to-human POST failed")
                            except Exception:
                                clog.exception("safe_exit: callback schedule failed")
                            # 4. Hang up — patient said they can't talk.
                            await _hangup("distress detected — safe exit")

                        asyncio.create_task(_safe_exit())
                        return
        except Exception:
            clog.debug("call hygiene: distress check failed", exc_info=True)
        # Voicemail detection: scan the first transcript chunks for the
        # signature phrases. Only effective inside voicemail_detect_window —
        # outside, the patient may legitimately mention these words.
        #
        # The window is anchored on the FIRST SPEECH HEARD, not on room
        # creation. With the Agent-First flow the room exists 20-30s before
        # the carrier voicemail picks up and starts talking, so a
        # room-creation anchor expired before the announcement even began —
        # Charlotte then chatted with the voicemail for 30-80s until the
        # idle watchdog gave up (observed on the June 10 go-live wave).
        try:
            if state.get("hung_up"):
                return
            text = getattr(ev, "transcript", None) or getattr(ev, "text", None) if ev is not None else None
            if not text:
                return
            now_ts = _t.monotonic()
            if state.get("first_speech_ts") is None:
                state["first_speech_ts"] = now_ts
            elapsed = now_ts - float(state["first_speech_ts"])
            if elapsed > voicemail_detect_window:
                return
            if _voicemail_re.search(str(text)):
                clog.info("call hygiene: voicemail detected via STT (t=%.1fs after first speech): %r", elapsed, str(text)[:120])
                asyncio.create_task(_hangup("voicemail detected via STT"))
                return
            # STRUCTURAL HEURISTIC — monologue without our reply.
            # Voicemails and AI screeners (Google Pixel, iOS Live VM)
            # produce CONSECUTIVE customer turns at machine pace with no
            # waiting for our reply. A real human says "Hello?" once and
            # then waits — even if they later launch into a long answer,
            # it's AFTER our greeting (the agent turn resets the counter).
            # We bail when ≥3 CONSECUTIVE customer turns totalling ≥14
            # words arrive before the agent has said anything. _on_item
            # resets customer_consec_turns whenever the assistant speaks.
            turns = state.get("customer_consec_turns") or []
            turns.append(str(text))
            state["customer_consec_turns"] = turns
            total_words = sum(len(t.split()) for t in turns)
            if len(turns) >= 3 and total_words >= 14:
                clog.info(
                    "call hygiene: voicemail/screener inferred from monologue "
                    "(t=%.1fs, %d consecutive customer turns, %d words): %r",
                    elapsed, len(turns), total_words, " | ".join(turns)[:160],
                )
                asyncio.create_task(_hangup("voicemail detected via monologue heuristic"))
        except Exception:
            clog.debug("call hygiene: voicemail STT check failed", exc_info=True)

    def _on_item(ev) -> None:
        try:
            item = getattr(ev, "item", None)
            role = getattr(item, "role", None) if item else None
            if role != "assistant":
                return
            text_attr = getattr(item, "text_content", None) if item else None
            text = text_attr() if callable(text_attr) else (text_attr or "")
            state["last_agent_ts"] = _t.monotonic()
            # The first assistant item flips the watchdog from "warming"
            # mode (waiting for the SIP participant to arrive in the Agent
            # First flow) into normal idle-detection mode.
            state["first_agent_turn"] = True
            # An agent turn breaks any in-progress customer monologue —
            # subsequent customer turns are responses to our greeting, not
            # a robotic broadcast, so reset the voicemail monologue counter.
            state["customer_consec_turns"] = []
            # Estimate TTS playback duration from the text length and pin a
            # 'speaking until' deadline so the watchdog can't fire mid-TTS
            # even when agent_state_changed events aren't delivered (observed
            # on multi-agent swarm handoffs to Victoria — Cartesia was 60+s
            # into a long question and idle 5s still triggered). Cartesia
            # speaks ~14-17 chars/sec; we use 12 chars/sec as a conservative
            # rate so the deadline never undershoots. Buffer +2s for any
            # network/packet variability at the end.
            text_len = len(str(text)) if text else 0
            if text_len > 0:
                # Cartesia speaks ~15 chars/sec on average; +0.3s tail
                # buffer is enough for the final phoneme to clear without
                # adding multiple seconds of phantom "still speaking" time
                # after every short utterance. The previous +2s buffer made
                # a 20-char greeting look like 3.7s of speech (vs ~1.5s
                # actual), which pushed the silence-detection floor from
                # 5s to ~7s.
                estimated_secs = max(1.0, text_len / 15.0 + 0.3)
                state["agent_speaking_until"] = _t.monotonic() + estimated_secs
            if text and _goodbye_re.search(str(text)):
                state["goodbye_armed_at"] = _t.monotonic()
                clog.info("call hygiene: goodbye detected — will hang up in %.1fs", goodbye_grace)
        except Exception:
            clog.exception("call hygiene: item hook failed")

    def _on_metrics(ev) -> None:
        # LLMMetrics (TTFT) and TTSMetrics (TTFB) fire during the streaming
        # window — much earlier than conversation_item_added, which only
        # commits at the END of LLM generation. Without this hook a long
        # TTS response (10-20s of Cartesia audio) looks like silence to
        # the watchdog and the idle timer wrongly trips.
        try:
            metrics = getattr(ev, "metrics", None)
            cls = type(metrics).__name__ if metrics is not None else ""
            if cls in ("LLMMetrics", "TTSMetrics", "EOUMetrics"):
                state["last_agent_ts"] = _t.monotonic()
        except Exception:
            pass

    def _on_agent_state(ev) -> None:
        # session.agent_state can be 'initializing' / 'listening' / 'thinking'
        # / 'speaking'. Treat thinking + speaking as 'active': during these
        # the agent is busy producing a turn and the idle watchdog must not
        # fire (the patient is listening, not silent-and-gone). The flag is
        # cleared the moment state goes back to 'listening', at which point
        # the watchdog resumes from a fresh last_agent_ts.
        try:
            new_state = (
                getattr(ev, "new_state", None)
                or getattr(ev, "state", None)
                or ""
            )
            new_state = str(new_state).lower()
            if new_state in ("speaking", "thinking"):
                state["agent_active"] = True
                state["last_agent_ts"] = _t.monotonic()
            else:
                # transitions to listening / initializing / anything else
                state["agent_active"] = False
                state["last_agent_ts"] = _t.monotonic()
        except Exception:
            clog.debug("call hygiene: agent_state hook failed", exc_info=True)

    for ev_name, fn in (
        ("user_input_transcribed", _on_user_speech),
        ("conversation_item_added", _on_item),
        ("metrics_collected", _on_metrics),
        ("agent_state_changed", _on_agent_state),
    ):
        try:
            session.on(ev_name, fn)
        except Exception:
            clog.debug("call hygiene: session.on(%s) unavailable", ev_name)

    async def _watchdog() -> None:
        try:
            # Give the first turn a small head start so the timer doesn't
            # arm before the greeting has even started. With the 1s preroll
            # + a short greeting + agent_speaking_until logic, a 1.5s
            # head-start is plenty — the watchdog will then idle-skip if
            # agent_speaking_until is still in the future.
            await asyncio.sleep(min(idle_timeout, max(1.5, idle_timeout / 3)))
            while not state["hung_up"]:
                # 0.5s poll keeps the worst-case overshoot of idle_timeout
                # to 0.5s instead of 1s. On a 5s idle target this changes
                # 'fires at T+5..6' into 'fires at T+5..5.5' — patient
                # hangs up half a second sooner on every silent call.
                await asyncio.sleep(0.5)
                # Honour in-flight saves: if save_contact_data is mid-PATCH,
                # delay any hangup until it completes so leads_rdv writes
                # don't get lost when the asyncio task is cancelled.
                if state.get("save_in_flight", 0) > 0:
                    continue
                # Honour active agent turns: if Charlotte is thinking or
                # speaking, hold off on the idle decision. Observed in
                # prod: a long TTS turn (Charlotte explaining the NHS S2
                # pathway) was cut at exactly idle_timeout because
                # last_agent_ts froze at the START of the turn. We honour
                # two signals: the session.agent_state_changed event (when
                # LiveKit delivers it — most reliable for single-agent
                # sessions) AND the agent_speaking_until deadline computed
                # from the latest assistant item's text length (backup for
                # the multi-agent swarm path, where state events for
                # Victoria/Isabelle weren't getting through and a 60s+
                # Cartesia question still tripped the 5s idle).
                if state.get("agent_active") or _t.monotonic() < state.get("agent_speaking_until", 0):
                    state["last_agent_ts"] = _t.monotonic()
                    continue
                # Agent First gate: the watchdog must NOT fire while the
                # agent is still in on_enter waiting for the SIP participant
                # to arrive + become active. Otherwise the 4s idle hangup
                # tears the call down before the patient can connect. The
                # gate releases when _on_item sets first_agent_turn=True
                # (the moment the greeting is emitted). Cap with a 60s
                # ceiling so a stuck on_enter can't pin the call forever.
                if not state.get("first_agent_turn"):
                    # Hard ceiling: 10 s from INVITE to FIRST CUSTOMER WORD.
                    # Wati's spec — if no STT transcript arrived in 10 s,
                    # treat as PAS DE REPONSE and hang up. This catches the
                    # Amy Luke-Telford case where the UK carrier acquitted
                    # the SIP leg fast (no ringingTimeout) but STT never
                    # heard a single word, leaving the agent to chat with
                    # the voicemail audio for 2 minutes.
                    no_speech_ceiling = float(os.getenv("NO_SPEECH_HANGUP_SECS", "10.0"))
                    if (
                        state.get("first_speech_ts") is None
                        and _t.monotonic() - state["call_started_at"] >= no_speech_ceiling
                    ):
                        clog.info(
                            "watchdog: no STT transcript within %.0fs — PAS DE REPONSE",
                            no_speech_ceiling,
                        )
                        await _hangup("no speech within hard ceiling")
                        return
                    if _t.monotonic() - state["call_started_at"] < 60.0:
                        state["last_agent_ts"] = _t.monotonic()
                        continue
                now = _t.monotonic()
                # Goodbye-armed path wins because it's the most deterministic.
                ga = state["goodbye_armed_at"]
                if ga is not None and (now - ga) >= goodbye_grace and (now - state["last_user_ts"]) >= goodbye_grace:
                    await _hangup("goodbye + grace")
                    return
                # LLM-in-flight guard (Wati 2026-06-12, Randy Chipungu):
                # never idle-hangup while the session is actively thinking
                # or speaking. The agent_state_changed event normally keeps
                # state['agent_active'] in sync, but a missed/late event
                # let a slow DeepSeek turn (5-10s TTFT spike) get cut at
                # the conversational-idle threshold — the patient confirmed
                # their identity and the call died mid-generation. Reading
                # session.agent_state directly is version-tolerant and
                # cheap.
                try:
                    _live_state = str(getattr(session, "agent_state", "") or "").lower()
                    if _live_state in ("thinking", "speaking"):
                        state["last_agent_ts"] = now
                        continue
                except Exception:
                    pass
                # Pure idle path. The effective threshold escalates once
                # the patient has spoken at all — see state['user_has_spoken']
                # init for the rationale.
                last_any = max(state["last_user_ts"], state["last_agent_ts"])
                effective_idle = (
                    conversational_idle
                    if state.get("user_has_spoken")
                    else idle_timeout
                )
                if now - last_any >= effective_idle:
                    await _hangup(
                        f"idle {effective_idle:.0f}s — likely voicemail or dropped audio"
                    )
                    return
                # Post-greeting / pre-user-speech voicemail catcher
                # (Wati June 10 v7 — Joanne Houston 42 s, Winifred Jonathan
                # 41 s). On UK carriers like EE/Three the network rings
                # 50+ s with in-band ringback before voicemail picks up.
                # The agent's canned greeting fires (first_agent_turn=True)
                # but no STT word arrives because tones aren't speech,
                # and the standard idle path was somehow not catching
                # them. Hard cap: if the agent has spoken at least once
                # but the customer never produced a single transcript
                # within VOICEMAIL_AFTER_GREETING_SECS (default 8 s),
                # kill the call and qualify as REPONDEUR.
                vm_after_greet = float(os.getenv("VOICEMAIL_AFTER_GREETING_SECS", "8.0"))
                if (
                    state.get("first_agent_turn")
                    and not state.get("user_has_spoken")
                    and state.get("first_speech_ts") is None
                    and now - state.get("last_agent_ts", state["call_started_at"]) >= vm_after_greet
                ):
                    clog.info(
                        "watchdog: %.0f s after canned greeting with no user STT — REPONDEUR",
                        vm_after_greet,
                    )
                    # Mark for REPONDEUR before _hangup so auto_qualify_call
                    # picks it up cleanly.
                    try:
                        cid_vm = getattr(ctx, "_call_id", None)
                        if cid_vm:
                            await asyncio.to_thread(
                                _ucm, cid_vm,
                                {"qualification": "REPONDEUR",
                                 "qualification_source": "post_greeting_no_stt"},
                            )
                    except Exception:
                        clog.debug("post-greeting REPONDEUR stamp failed", exc_info=True)
                    await _hangup("post-greeting no-STT ceiling — voicemail suspected")
                    return
        except asyncio.CancelledError:
            pass
        except Exception:
            clog.exception("call hygiene: watchdog crashed")

    task = asyncio.create_task(_watchdog())

    async def _cancel_on_shutdown():
        task.cancel()
    try:
        ctx.add_shutdown_callback(_cancel_on_shutdown)
    except Exception:
        pass

    clog.info(
        "call hygiene: armed (idle=%.0fs, goodbye_grace=%.0fs)",
        idle_timeout, goodbye_grace,
    )


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


def _wire_usage_billing(ctx, session: AgentSession, call_id, org_id, clog) -> None:
    """Accumulate this call's REAL usage (LLM tokens, TTS chars, STT seconds)
    via a UsageCollector, and flush it to the web app at shutdown so the
    dashboard cost reflects actual consumption. Never blocks the call."""
    if not org_id:
        clog.debug("usage billing: no org_id — skipping")
        return
    # Start a monotonic timer here so call_seconds at flush time is the real
    # wall-clock duration of the AgentSession (used as a Twilio fallback).
    import time as _t_billing_start
    _session_started_monotonic = _t_billing_start.monotonic()
    try:
        from livekit.agents import metrics as _metrics
        from db_writes import record_agent_usage
    except Exception:
        clog.debug("usage billing: metrics/db unavailable")
        return

    collector = _metrics.UsageCollector()

    def _collect(ev):
        try:
            m = getattr(ev, "metrics", None) or ev
            collector.collect(m)
        except Exception:
            pass

    for ev_name in ("metrics_collected", "metrics"):
        try:
            session.on(ev_name, _collect)
            break
        except Exception:
            continue

    async def _flush():
        try:
            s = collector.get_summary()
            llm_tokens = int(getattr(s, "llm_prompt_tokens", 0) or 0) + int(getattr(s, "llm_completion_tokens", 0) or 0)
            tts_chars = int(getattr(s, "tts_characters_count", 0) or 0)
            stt_seconds = float(getattr(s, "stt_audio_duration", 0.0) or 0.0)
            # Wall-clock call duration is used as a fallback for the
            # call_minutes usage event when Twilio's StatusCallback never
            # reaches us. /api/usage/agent dedupes against any pre-existing
            # call_minutes row so it's safe to send unconditionally.
            import time as _t_billing
            call_seconds = max(0.0, _t_billing.monotonic() - _session_started_monotonic)
            clog.info(
                "usage: llm_tokens=%d tts_chars=%d stt_secs=%.1f call_secs=%.1f",
                llm_tokens, tts_chars, stt_seconds, call_seconds,
            )
            await asyncio.to_thread(
                record_agent_usage, org_id, call_id,
                llm_tokens=llm_tokens, tts_chars=tts_chars,
                stt_seconds=stt_seconds, call_seconds=call_seconds,
            )
        except Exception:
            clog.exception("usage billing flush failed")

    try:
        ctx.add_shutdown_callback(_flush)
    except Exception:
        clog.debug("usage billing: add_shutdown_callback unavailable")


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


def _load_campaign_call_tuning(campaign_id: str) -> dict:
    """Read the per-campaign call-tuning block from campaigns.metadata.

    Wati 2026-06-12 A/B setup: production campaigns run the proven
    defaults; the test-table campaign carries experimental knobs that we
    graduate to production once validated. All flags live in DB so they
    can be flipped via SQL without a redeploy. Recognised keys:

      greeting_mode          "on_answer" | "speech_first" (default)
      llm_provider           "openai" | "anthropic" | "deepseek" | "minimax"
      llm_model              e.g. "gpt-4o-mini"
      tts_sample_rate        e.g. 8000 (native telephony rendering)
      min_endpointing_delay  e.g. 0.4 (seconds)
      quick_ack              true → instant canned filler ("Mm-hmm.")
                             on each user turn while the LLM generates
    """
    try:
        from db_writes import _supabase_headers as _sb_h, _supabase_url as _sb_u, has_supabase as _sb_has
        if not _sb_has() or not campaign_id:
            return {}
        import httpx as _httpx
        with _httpx.Client(timeout=_httpx.Timeout(4.0), headers=_sb_h()) as c:
            r = c.get(_sb_u(f"/rest/v1/campaigns?id=eq.{campaign_id}&select=metadata"))
            if not r.is_success:
                return {}
            rows = r.json() or []
            md = (rows[0] or {}).get("metadata") if rows else None
            if isinstance(md, dict):
                keys = ("greeting_mode", "llm_provider", "llm_model", "tts_sample_rate", "min_endpointing_delay", "quick_ack")
                return {k: md[k] for k in keys if md.get(k) is not None}
    except Exception:
        logger.debug("call-tuning load failed (campaign=%s)", campaign_id, exc_info=True)
    return {}


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

    # Resolve call_id from the SIP participant attributes when the room
    # metadata path didn't yield one. This is the Path B outbound case: the
    # dialer doesn't pre-create the calls row, the Twilio status webhook does,
    # and /api/twilio-voice forwards the resolved id on the SIP INVITE as
    # X-LK-Call-Id. Without this fallback, ctx._call_id stays None for every
    # Twilio-bridged call → auto_qualify_call(None) early-returns →
    # calls.metadata.qualification is never written → dashboard's "Ce qu'ils
    # ont dit" stays at zero. (Same sip.h.* gotcha as agent_id: the literal
    # 'X-LK-Call-Id' string is what `axon.call_id` resolves to if it's mapped
    # via the dispatch rule attributes block, so we prefer the lowercase
    # forwarded-header key first.)
    if not call_id:
        candidate = (
            p_attrs.get("sip.h.x-lk-call-id")
            or p_attrs.get("call_id")
            or p_attrs.get("axon.call_id")
        )
        if candidate and not str(candidate).startswith("X-LK-"):
            call_id = str(candidate)
            clog = _logger_for_call(call_id)
            clog.info("resolved call_id=%s from SIP participant attrs", call_id)

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

    # Same forwarded-SIP-header gotcha applies to target_id. The target row
    # carries the per-contact variables we substitute into the prompt
    # ({{patient_firstname}}, {{bmi}}, {{note}}, …).
    target_id = (
        p_attrs.get("sip.h.x-lk-target-id")
        or p_attrs.get("target_id")
        or p_attrs.get("axon.target_id")
    )
    if target_id and str(target_id).startswith("X-LK-"):
        target_id = None

    # agent_handle_id: identifies the persona slot in the team org chart. The
    # `transfer_to_human` tool stamps this on the callback task so the desk can
    # audit which agent triggered the transfer. Same forwarded-SIP-header
    # gotcha as agent_id / target_id.
    agent_handle_id = (
        p_attrs.get("sip.h.x-lk-agent-handle-id")
        or p_attrs.get("agent_handle_id")
        or p_attrs.get("axon.agent_handle_id")
    )
    if agent_handle_id and str(agent_handle_id).startswith("X-LK-"):
        agent_handle_id = None

    # Simulation: the in-app "Tester ce script" UI passes a script_id directly
    # (no campaign). We render that script into the prompt so the tester can run
    # the full flow — including multi-agent handoffs — without a campaign.
    sim_script_id = p_attrs.get("script_id") or p_attrs.get("axon.script_id")
    if sim_script_id and str(sim_script_id).startswith("X-LK-"):
        sim_script_id = None

    # Load the agent config, the campaign script, and the per-target context
    # CONCURRENTLY off the asyncio event loop (all are blocking httpx calls to
    # Supabase). Running them in parallel — instead of back-to-back, and
    # without blocking the loop that drives the room/audio — cuts the dead-air
    # the caller hears before the agent greets.
    async def _load(fn, arg):
        return await asyncio.to_thread(fn, str(arg)) if arg else None

    axon, script_text, target_vars, sim_script_text, campaign_tuning = await asyncio.gather(
        _load(load_agent, agent_id),
        _load(load_campaign_script, campaign_id),
        _load(load_target_context, target_id),
        _load(load_script_by_id, sim_script_id),
        _load(_load_campaign_call_tuning, campaign_id),
    )
    campaign_tuning = campaign_tuning or {}
    if campaign_tuning:
        clog.info("campaign call-tuning: %s", campaign_tuning)
    # Per-campaign LLM override — only applied when the matching API key is
    # present on the worker, so a typo'd provider can't kill a whole slot.
    _tun_provider = str(campaign_tuning.get("llm_provider") or "").lower()
    _provider_keys = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "minimax": "MINIMAX_API_KEY",
    }
    if _tun_provider and axon:
        _need = _provider_keys.get(_tun_provider)
        if _need and not os.getenv(_need) and not (_tun_provider == "anthropic" and os.getenv("CLAUDE_API_KEY")):
            clog.warning("call-tuning llm_provider=%s ignored — %s missing on worker", _tun_provider, _need)
        else:
            axon.llm_provider = _tun_provider
            if campaign_tuning.get("llm_model"):
                axon.llm_model = str(campaign_tuning["llm_model"])
            clog.info("call-tuning LLM override: %s / %s", axon.llm_provider, axon.llm_model)
    target_vars = target_vars or {}
    # In simulation the script comes by id (no campaign); prefer it.
    if sim_script_text and not script_text:
        script_text = sim_script_text

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

    if script_text:
        clog.info(
            "script injected (%d chars) [campaign=%s sim_script=%s]",
            len(script_text), campaign_id, sim_script_id,
        )
        instructions = f"{instructions}\n\n{script_text}"
    elif campaign_id:
        clog.info("campaign %s has no script — using agent base prompt", campaign_id)

    # Template substitution: resolve every {{var}} in the system prompt and
    # greeting using the per-target context (contact attributes, computed
    # firstname/lastname, current_date, etc.). Unknown keys stay literal so
    # missing data is visible in logs instead of silently empty.
    from datetime import date as _date
    template_vars = dict(target_vars)
    # Simulation mode: the web "Test in simulation" UI ships an inline JSON
    # blob of variables via participant attributes instead of going through a
    # campaign target row. These override anything from the target (so a
    # tester can poke specific values without touching the DB).
    sim_raw = p_attrs.get("simulation_vars")
    if sim_raw:
        try:
            import json as _json_sim
            sim_dict = _json_sim.loads(sim_raw)
            if isinstance(sim_dict, dict):
                template_vars.update(sim_dict)
                clog.info(
                    "[call_id=%s] simulation_vars merged (%d keys)",
                    call_id, len(sim_dict),
                )
        except Exception:
            clog.warning("[call_id=%s] simulation_vars present but unparsable", call_id)
    template_vars.setdefault("current_date", _date.today().isoformat())
    if axon:
        template_vars.setdefault("agent_name", axon.name)
    instructions = render_template(instructions, template_vars)
    greeting = render_template(greeting, template_vars)
    if template_vars:
        clog.info(
            "[call_id=%s] template vars resolved (%d keys: %s)",
            call_id, len(template_vars), sorted(template_vars.keys()),
        )

    # Language lock + quick-ack now centralized in helpers so the wording stays
    # in sync between this entrypoint and _assemble_agent_runtime (used on
    # handoff). The previous code path injected French fillers regardless of
    # the persona's declared language, which was one cause of the EN/DE/FR
    # drift observed in the Fly logs.
    instructions = _apply_language_lock(instructions, axon)
    if os.getenv("QUICK_ACK", "true").lower() not in ("false", "0", "no"):
        instructions = f"{instructions}\n{_quick_ack_directive(axon)}"

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

    # Build each provider separately so a failure points to the exact
    # component (STT / LLM / TTS) in the call logs instead of an opaque
    # "unhandled exception". Each logs and re-raises with a clear marker.
    try:
        _stt = _stt_for(axon)
    except Exception:
        clog.exception("BUILD FAILED: STT (AssemblyAI). Check ASSEMBLYAI_API_KEY on Fly.")
        raise
    try:
        _llm = _llm_for(axon)
    except Exception:
        clog.exception(
            "BUILD FAILED: LLM (provider=%s model=%s). Check the matching *_API_KEY on Fly.",
            (axon.llm_provider if axon else None),
            (axon.llm_model if axon else None),
        )
        raise
    try:
        _tun_sr = campaign_tuning.get("tts_sample_rate")
        _tts = _tts_for(axon, sample_rate=int(_tun_sr) if _tun_sr else None)
    except Exception:
        clog.exception("BUILD FAILED: TTS (Cartesia). Check CARTESIA_API_KEY on Fly.")
        raise

    session_kwargs: dict = dict(
        stt=_stt,
        llm=_llm,
        tts=_tts,
        vad=vad,
    )

    # Latency & naturalness tuning. The API moved between livekit-agents
    # versions: the old top-level kwargs (min_endpointing_delay,
    # preemptive_generation, allow_interruptions, turn_detection) were
    # deprecated and silently ignored in newer builds — they live under
    # `turn_handling=TurnHandlingOptions(...)` now. We try the new API first
    # and fall back to the old kwargs otherwise. Either way, signature-filter
    # so unknown kwargs are dropped instead of crashing.
    #
    # Default 0.55s — measured compromise. 0.10s was too aggressive (fragmented
    # speech like "Megan, Claudia, Kenneth / 17 / 1993" got split into 3 turns,
    # wedging the pipeline). 0.80s was safe but added ~250ms perceived lag on
    # every turn (EOU climbed from ~1.4s to ~1.7s in production logs).
    # 0.55s preserves fragmented-speech grouping for short pauses while
    # cutting the average response time. Override via MIN_ENDPOINTING_DELAY.
    # Per-campaign override first (test-campaign latency experiments),
    # then env, then the measured 0.55s production compromise.
    _tun_endp = campaign_tuning.get("min_endpointing_delay")
    min_endp = float(_tun_endp) if _tun_endp else float(os.getenv("MIN_ENDPOINTING_DELAY", "0.55"))

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
        # In-call CRM write-back: give the agent a save_contact_data tool bound
        # to THIS call's contact (resolved from the campaign target). Lets
        # Isabelle persist bmi, Victoria persist DOB/allergies, etc. mid-call.
        _save_contact_id = target_vars.get("__contact_id__")
        _save_org_id = target_vars.get("__org_id__") or (axon.org_id if axon else None)
        _save_table = target_vars.get("__data_table__")
        _save_row = target_vars.get("__data_row_id__")
        _save_tool = _build_save_contact_tool(
            _save_contact_id, _save_org_id, _save_table, _save_row,
            call_id=call_id,
        )
        if _save_tool is not None:
            tools.append(_save_tool)
            clog.info(
                "save_contact_data tool enabled (mode=%s contact=%s table=%s row=%s)",
                "data_table" if (_save_table and _save_row) else "contact",
                _save_contact_id, _save_table, _save_row,
            )
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
        # transfer_to_human: when the AI decides the patient needs a human
        # follow-up (RDV booking, complex objection, callback request), this
        # tool POSTs to the web app which creates a human_callback_task
        # scheduled for the next business day. Returns None (and logs) if
        # env vars (INTERNAL_AGENT_API_TOKEN, NEXT_PUBLIC_APP_URL) or org_id
        # are missing — so older deployments don't crash.
        try:
            from tools_transfer import build_transfer_to_human_tool
            transfer_human_tool = build_transfer_to_human_tool(
                org_id=(axon.org_id if axon else None),
                contact_id=target_vars.get("__contact_id__"),
                call_id=call_id,
                agent_handle_id=agent_handle_id,
            )
        except Exception:
            clog.exception("transfer_to_human tool build failed")
            transfer_human_tool = None
        if transfer_human_tool is not None:
            tools.append(transfer_human_tool)
            clog.info("transfer_to_human tool enabled")
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
    # Greeting mode A/B (Wati 2026-06-12): DB flag wins, env list as
    # backup. Default (None) = speech-first, the proven production flow.
    _env_on_answer_ids = {
        s.strip() for s in os.getenv("GREETING_ON_ANSWER_CAMPAIGN_IDS", "").split(",") if s.strip()
    }
    greet_on_answer = (
        campaign_tuning.get("greeting_mode") == "on_answer"
        or (campaign_id is not None and str(campaign_id) in _env_on_answer_ids)
    )
    if greet_on_answer:
        clog.info("greeting mode: ON-ANSWER (experimental, campaign=%s)", campaign_id)

    clog.info("timing: session.start() begin")
    await session.start(
        room=ctx.room,
        agent=AxonVoiceAgent(
            instructions=instructions,
            tools=tools,
            greeting=greeting,
            greet_on_answer=greet_on_answer,
            quick_ack=bool(campaign_tuning.get("quick_ack")),
            # Pass the SIP participant already resolved by
            # ctx.wait_for_participant() so on_enter can poll its
            # sip.callStatus directly. None for browser/desk sessions.
            sip_participant=participant if (
                participant is not None
                and any(
                    str(k).startswith("sip.")
                    for k in (getattr(participant, "attributes", None) or {}).keys()
                )
            ) else None,
        ),
    )
    clog.info("timing: session.start() returned in %.2fs", _time2.monotonic() - _t_start)
    # Stamp when the agent session became active (SIP participant in the room,
    # session running). This becomes the call's `answered_at` for the DB
    # fallback if Twilio's StatusCallback never reaches us — see _on_shutdown.
    from datetime import datetime as _dt2, timezone as _tz2
    _session_answered_at_iso = _dt2.now(_tz2.utc).isoformat()
    # Stamp the LiveKit room name onto calls.metadata so the
    # /api/livekit/agent-webhook can match an inbound LK session-ended
    # webhook to its call row by exact equality instead of relying on a
    # fragile room-name regex.
    try:
        from db_writes import update_call_metadata as _ucm
        room_name = getattr(ctx.room, "name", None)
        meta_patch: dict = {}
        if room_name:
            meta_patch["lk_room_name"] = room_name
        # Twilio CallSid is forwarded by LiveKit's SIP plugin as a participant
        # attribute. Capture it so /api/dashboard/call-recording can lazily
        # backfill the trunk-level recording (Twilio's trunk recording doesn't
        # post a webhook — the only way to find the audio is the Recordings
        # REST API, keyed by CallSid).
        twilio_sid = p_attrs.get("sip.twilio.callSid") or p_attrs.get("sip.twilio.callsid")
        if twilio_sid and call_id:
            meta_patch["twilio_call_sid"] = str(twilio_sid)
        if meta_patch and call_id:
            await asyncio.to_thread(_ucm, call_id, meta_patch)
        # Agent First race: p_attrs is snapshotted when the entrypoint
        # resolves the participant — often while the SIP leg is still
        # 'dialing', BEFORE LiveKit's plugin publishes sip.twilio.callSid.
        # Result on the June 10 wave: only 4/50 calls had the SID stamped,
        # so recordings (resolved via the Twilio Recordings API keyed by
        # CallSid) showed "indisponible" everywhere. Poll the LIVE attrs in
        # the background and stamp as soon as the SID appears.
        if call_id and not twilio_sid and participant is not None:
            async def _stamp_sid_when_available() -> None:
                try:
                    for _ in range(90):
                        attrs = dict(getattr(participant, "attributes", None) or {})
                        sid = attrs.get("sip.twilio.callSid") or attrs.get("sip.twilio.callsid")
                        if sid:
                            # Stamp BOTH the top-level column and metadata
                            # so the hangup REST end-call lookup works
                            # whether it reads the column or the JSON path
                            # (Wati's +447359842582 case: agent hung up at
                            # 11s but Twilio billed 2:52 because the lookup
                            # read the empty top-level column and never
                            # fired the REST end-call).
                            await asyncio.to_thread(
                                _ucm, call_id, {"twilio_call_sid": str(sid)},
                            )
                            try:
                                from db_writes import _supabase_headers as _h, _supabase_url as _u
                                import httpx as _hx
                                with _hx.Client(timeout=_hx.Timeout(3.0), headers=_h()) as _c:
                                    _c.patch(
                                        _u(f"/rest/v1/calls?id=eq.{call_id}"),
                                        headers={**_h(), "Content-Type": "application/json", "Prefer": "return=minimal"},
                                        json={"twilio_call_sid": str(sid)},
                                    )
                            except Exception:
                                clog.debug("twilio_call_sid top-level stamp failed", exc_info=True)
                            clog.info("twilio_call_sid stamped late (deferred poll): %s", sid)
                            return
                        await asyncio.sleep(1.0)
                    clog.warning("twilio_call_sid never appeared in participant attrs (90s)")
                except Exception:
                    clog.exception("deferred twilio_call_sid stamp failed")
            asyncio.create_task(_stamp_sid_when_available())
    except Exception:
        clog.exception("could not stamp lk_room_name/twilio_call_sid on calls.metadata")
    _wire_transcript_hooks(session, call_id)
    _wire_latency_metrics(session, clog)
    _wire_debug_logs(session, clog)
    _wire_usage_billing(ctx, session, call_id, (axon.org_id if axon else None), clog)
    # Auto-hangup so we don't burn TTS/STT minutes on voicemails, dropped
    # audio, or patients who hung up without ending the call. Env-tunable.
    try:
        ctx._call_id = call_id  # type: ignore[attr-defined]
    except Exception:
        pass
    _install_call_hygiene(ctx, session, clog)

    # Multi-agent team journey (Charlotte → Isabelle → Victoria): watch for
    # `handoff_to` in room metadata and fully swap the running agent — prompt,
    # greeting, tools, LLM and TTS — to the requested sibling, keeping the same
    # call + the same write-back target. Without this, transfer_to_specialist
    # only patches metadata that nobody reads.
    if axon:
        _install_team_handoff_watcher(
            ctx,
            session,
            template_vars=template_vars,
            save_contact_id=target_vars.get("__contact_id__"),
            save_org_id=target_vars.get("__org_id__") or (axon.org_id if axon else None),
            save_table=target_vars.get("__data_table__"),
            save_row=target_vars.get("__data_row_id__"),
            clog=clog,
            call_id=call_id,
        )

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
        # 0. Wait briefly for any in-flight save_contact_data to complete
        #    BEFORE we finalize. The save_in_flight counter is bumped by
        #    the tool around its HTTP PATCH; if the watchdog or the room
        #    closed mid-call, the write may still be racing.
        try:
            _hyg = _HYGIENE_STATES.get(call_id or "")
            if isinstance(_hyg, dict):
                for _ in range(50):  # up to 5s waiting in 100ms slices
                    if int(_hyg.get("save_in_flight", 0)) <= 0:
                        break
                    await asyncio.sleep(0.1)
        except Exception:
            pass
        # 1. Write definitive call state to the DB so the dashboard shows a
        #    finished call. Necessary because Twilio's StatusCallback often
        #    can't reach our Vercel endpoint (APP_URL env mismatch on Fly /
        #    LiveKit Cloud Agents, signature drift, etc.) and the calls row
        #    would otherwise stay in 'ringing' forever.
        try:
            from db_writes import finalize_call_state as _finalize
            from datetime import datetime as _dt_end, timezone as _tz_end
            _ended_iso = _dt_end.now(_tz_end.utc).isoformat()
            duration = None
            try:
                start = _dt_end.fromisoformat(_session_answered_at_iso)
                end = _dt_end.fromisoformat(_ended_iso)
                duration = max(0, int((end - start).total_seconds()))
            except Exception:
                pass
            await asyncio.to_thread(
                _finalize,
                call_id,
                answered_at=_session_answered_at_iso,
                ended_at=_ended_iso,
                duration_secs=duration,
                state="ended",
            )
        except Exception:
            clog.exception("finalize_call_state failed at shutdown")
        # 1b. Heuristic qualification fallback when the AI didn't write one.
        #     MUST run AFTER finalize_call_state so duration_secs is fresh,
        #     and BEFORE the post-call summary pipeline so the LLM summary
        #     can see the inferred bucket. Never overrides an explicit
        #     qualification set by save_contact_data.
        try:
            from db_writes import auto_qualify_call as _auto_q
            await asyncio.to_thread(_auto_q, call_id)
        except Exception:
            clog.exception("auto_qualify_call failed at shutdown")
        # 2. Trigger LLM summary + analysis (best-effort, needs APP_URL set).
        try:
            trigger_post_call_pipeline(call_id)
        except Exception:
            clog.exception("post-call pipeline trigger failed")
        # Force LiveKit to release the room. Without this the room can linger
        # for the project's empty_timeout (often 5-15 min) — and on prod we
        # observed dozens of "active" rooms piling up to 87 min, saturating
        # the worker and starving fresh calls of LLM/TTS bandwidth.
        try:
            from livekit import api as _lk_api  # local import: optional dep
            lk_url = os.getenv("LIVEKIT_URL")
            lk_key = os.getenv("LIVEKIT_API_KEY")
            lk_secret = os.getenv("LIVEKIT_API_SECRET")
            if lk_url and lk_key and lk_secret and getattr(ctx, "room", None):
                room_name = getattr(ctx.room, "name", None)
                if room_name:
                    async with _lk_api.LiveKitAPI(lk_url, lk_key, lk_secret) as lkapi:
                        await lkapi.room.delete_room(
                            _lk_api.DeleteRoomRequest(room=room_name),
                        )
                    clog.info("room cleanup: deleted LiveKit room %s", room_name)
        except Exception:
            # Best-effort. A failed DeleteRoom only leaks one room and the
            # post-call pipeline already fired above.
            clog.exception("room cleanup: DeleteRoom failed")
        # Drop the per-call hygiene state from the module-level map so the
        # process doesn't accumulate state for finished calls.
        try:
            if call_id and call_id in _HYGIENE_STATES:
                _HYGIENE_STATES.pop(call_id, None)
        except Exception:
            pass

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
