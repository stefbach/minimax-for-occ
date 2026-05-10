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
from livekit.plugins import deepgram, minimax, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from n8n_tools import N8nClient, build_n8n_tools

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
        tools = build_n8n_tools(N8nClient())
        logger.info("n8n tools enabled (%d)", len(tools))

    await session.start(
        room=ctx.room,
        agent=Agent(instructions=INSTRUCTIONS, tools=tools),
    )

    await session.generate_reply(
        instructions=(
            "Salue brièvement l'utilisateur en français, présente-toi comme un "
            "assistant vocal MiniMax, et invite-le à parler."
        ),
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
