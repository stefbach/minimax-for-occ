"""LiveKit voice agent powered by MiniMax (LLM + TTS) with Deepgram STT.

Run locally:
    python agent.py dev

Deploy to LiveKit Cloud Agents:
    lk agent create
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.agents.llm import ChatContext
from livekit.plugins import deepgram, minimax, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv()

logger = logging.getLogger("minimax-voice-agent")
logger.setLevel(logging.INFO)


INSTRUCTIONS = """Tu es un assistant vocal multilingue (français et anglais).
Tu réponds de façon naturelle, brève et conversationnelle, adaptée à la voix.
Détecte la langue de l'utilisateur et réponds dans la même langue.
Évite les listes à puces, les titres et tout formatage markdown : tu parles, tu n'écris pas.
Si l'utilisateur te pose une question complexe, propose d'abord une réponse courte,
puis demande s'il veut plus de détails.

Tu peux déclencher des workflows n8n via les outils fournis :
- list_n8n_workflows pour découvrir ce qui est disponible,
- trigger_n8n_workflow(webhook_path, payload_json) pour exécuter,
- get_n8n_execution(execution_id) pour suivre un résultat.
Confirme toujours brièvement à l'utilisateur avant de déclencher une action
qui a un effet de bord (envoi d'email, paiement, prise de rendez-vous, etc.)."""


def _minimax_llm() -> openai.LLM:
    """MiniMax-M2 via OpenAI-compatible endpoint."""
    api_key = os.environ["MINIMAX_API_KEY"]
    base_url = os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
    model = os.getenv("MINIMAX_MODEL", "MiniMax-M2")
    return openai.LLM(model=model, base_url=base_url, api_key=api_key)


def _seed_user_turn(ctx: ChatContext, content: str) -> None:
    """Best-effort cross-version helper to inject a user message.

    livekit-agents has shipped two different ChatContext APIs in the
    1.x line; try the modern one first, fall back to the older shape.
    """
    try:
        ctx.add_message(role="user", content=content)  # newer API
        return
    except (AttributeError, TypeError):
        pass
    try:
        ctx.append(role="user", text=content)  # older API
        return
    except (AttributeError, TypeError):
        pass
    # Last resort: poke the underlying messages list directly.
    from livekit.agents.llm import ChatMessage
    ctx.messages.append(ChatMessage(role="user", content=content))


class MinimaxAgent(Agent):
    """Agent that greets via TTS instead of via the default LLM auto-greet.

    LiveKit Agents 1.5's default `Agent.on_enter()` triggers a
    `generate_reply()` with no user message, which MiniMax rejects with
    HTTP 400 "chat content is empty (2013)". We override on_enter to do
    a deterministic TTS-only greeting and let the conversation start
    properly when the user speaks.
    """

    GREETING = (
        "Bonjour, je suis votre assistant vocal MiniMax. "
        "Vous pouvez me parler en français ou en anglais, je vous écoute."
    )

    async def on_enter(self) -> None:
        await self.session.say(text=self.GREETING, allow_interruptions=True)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    voice_id = os.getenv("MINIMAX_VOICE_ID")  # cloned voice or preset id
    tts_kwargs: dict = {}
    if voice_id:
        tts_kwargs["voice"] = voice_id
    if model := os.getenv("MINIMAX_TTS_MODEL"):
        tts_kwargs["model"] = model
    if emotion := os.getenv("MINIMAX_TTS_EMOTION"):
        tts_kwargs["emotion"] = emotion

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=_minimax_llm(),
        tts=minimax.TTS(**tts_kwargs),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    tools = []
    if os.getenv("N8N_BASE_URL") and os.getenv("N8N_API_KEY"):
        try:
            from n8n_tools import N8nClient, build_n8n_tools
            tools = build_n8n_tools(N8nClient())
            logger.info("n8n tools enabled (%d)", len(tools))
        except Exception:
            logger.exception("n8n tools failed to load; running without them")

    # MiniMax-M2 rejects chat completions whose `messages` array contains only
    # system entries with HTTP 400 "chat content is empty (2013)". The framework
    # may auto-trigger generate_reply (e.g. on a VAD false-positive) before the
    # user has spoken, so we seed the chat context with a placeholder user turn
    # to guarantee the array is never empty when the LLM is called.
    seed_ctx = ChatContext()
    _seed_user_turn(seed_ctx, "Bonjour.")

    await session.start(
        room=ctx.room,
        agent=MinimaxAgent(
            instructions=INSTRUCTIONS,
            tools=tools,
            chat_ctx=seed_ctx,
        ),
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
