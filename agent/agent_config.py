"""Read per-agent configuration from Supabase at session start.

The front-end mints LiveKit tokens that embed `{"agent_id": "..."}` in
both the participant attributes AND room metadata, depending on which
LiveKit Agents version reads which.  This module abstracts that lookup.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger("axon.config")


@dataclass
class AxonAgent:
    id: str
    name: str
    language: str
    llm_provider: str
    llm_model: str
    tts_voice_id: Optional[str]
    tts_emotion: Optional[str]
    tts_speed: float
    system_prompt: str
    greeting: str
    rag_enabled: bool
    rag_top_k: int
    n8n_workflows: list[dict[str, Any]]


DEFAULT_PROMPT = (
    "Tu es un assistant vocal multilingue (FR/EN). Détecte la langue de "
    "l'utilisateur et réponds dans la même. Sois bref et conversationnel, "
    "adapté à la voix. Évite tout formatage markdown."
)
DEFAULT_GREETING = (
    "Bonjour, je suis votre assistant vocal. Vous pouvez me parler en "
    "français ou en anglais, je vous écoute."
)


def _supabase_headers() -> dict[str, str]:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }


def _supabase_url(path: str) -> str:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    return f"{base}{path}"


def has_supabase() -> bool:
    return bool(os.getenv("SUPABASE_URL")) and bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def _agent_id_from_metadata(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    aid = data.get("agent_id") if isinstance(data, dict) else None
    return str(aid) if aid else None


def resolve_agent_id(*, room_metadata: Optional[str], participant_attributes: Optional[dict]) -> Optional[str]:
    """Try participant attributes first, fall back to room metadata."""
    if participant_attributes:
        aid = participant_attributes.get("agent_id")
        if aid:
            return str(aid)
    return _agent_id_from_metadata(room_metadata)


def load_agent(agent_id: str) -> Optional[AxonAgent]:
    if not has_supabase():
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0), headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(f"/rest/v1/agents?id=eq.{agent_id}&select=*"))
            r.raise_for_status()
            rows = r.json()
            if not rows:
                logger.warning("agent %s not found in supabase", agent_id)
                return None
            a = rows[0]

            r2 = c.get(
                _supabase_url(
                    f"/rest/v1/agent_n8n_workflows?agent_id=eq.{agent_id}&enabled=is.true&select=*"
                )
            )
            r2.raise_for_status()
            workflows = r2.json() or []
    except Exception:
        logger.exception("failed to load agent %s from supabase", agent_id)
        return None

    return AxonAgent(
        id=a["id"],
        name=a.get("name", "Agent"),
        language=a.get("language") or "multi",
        llm_provider=a.get("llm_provider") or "openai",
        llm_model=a.get("llm_model") or "gpt-4o-mini",
        tts_voice_id=a.get("tts_voice_id"),
        tts_emotion=a.get("tts_emotion"),
        tts_speed=float(a.get("tts_speed") or 1.0),
        system_prompt=(a.get("system_prompt") or DEFAULT_PROMPT).strip(),
        greeting=(a.get("greeting") or DEFAULT_GREETING).strip(),
        rag_enabled=bool(a.get("rag_enabled")),
        rag_top_k=int(a.get("rag_top_k") or 4),
        n8n_workflows=workflows,
    )


def rag_search(agent_id: str, query: str, top_k: int = 4) -> list[dict[str, Any]]:
    """Embed `query` via OpenAI and call the match_documents RPC for `agent_id`."""
    if not has_supabase():
        return []
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return []
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0)) as c:
            emb = c.post(
                "https://api.openai.com/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": "text-embedding-3-small", "input": query},
            )
            emb.raise_for_status()
            embedding = emb.json()["data"][0]["embedding"]

            r = c.post(
                _supabase_url("/rest/v1/rpc/match_documents"),
                headers={**_supabase_headers(), "Content-Type": "application/json"},
                json={
                    "agent": agent_id,
                    "query_embedding": embedding,
                    "match_count": top_k,
                    "similarity_threshold": 0.3,
                },
            )
            r.raise_for_status()
            return r.json() or []
    except Exception:
        logger.exception("rag_search failed for agent %s", agent_id)
        return []
