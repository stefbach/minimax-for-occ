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

import logging
import os
from typing import Optional

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import deepgram, minimax, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from agent_config import AxonAgent, load_agent, rag_search, resolve_agent_id

load_dotenv()

logger = logging.getLogger("axon-voice-agent")
logger.setLevel(logging.INFO)


# ─── LLM factory ──────────────────────────────────────────────────────────
def _llm_for(agent: Optional[AxonAgent]):
    """Build a LiveKit-Agents-compatible LLM from the agent's provider/model."""
    provider = (agent.llm_provider if agent else os.getenv("LLM_PROVIDER", "openai")).lower()
    model = (agent.llm_model if agent and agent.llm_model else os.getenv("OPENAI_MODEL", "gpt-4o-mini"))

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

    return openai.LLM(model=model or "gpt-4o-mini", api_key=os.environ["OPENAI_API_KEY"])


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


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    # Resolve which agent persona this room is for.
    agent_id = resolve_agent_id(
        room_metadata=ctx.room.metadata,
        participant_attributes=None,
    )
    if not agent_id:
        # Try to read from the first remote participant once they join.
        for p in ctx.room.remote_participants.values():
            attrs = getattr(p, "attributes", None) or {}
            if attrs.get("agent_id"):
                agent_id = str(attrs["agent_id"])
                break

    axon = load_agent(agent_id) if agent_id else None
    if axon:
        logger.info("loaded agent %s (%s)", axon.id, axon.name)
    else:
        logger.info("no agent_id resolved; using env defaults")

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
            logger.info("RAG tool enabled (top-%d)", axon.rag_top_k)
    else:
        # legacy path: env-only n8n tools
        if os.getenv("N8N_BASE_URL") and os.getenv("N8N_API_KEY"):
            try:
                from n8n_tools import N8nClient, build_n8n_tools
                tools = build_n8n_tools(N8nClient())
                logger.info("n8n tools enabled (%d) — legacy mode", len(tools))
            except Exception:
                logger.exception("n8n tools failed to load")

    await session.start(
        room=ctx.room,
        agent=AxonVoiceAgent(
            instructions=instructions,
            tools=tools,
            greeting=greeting,
        ),
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
