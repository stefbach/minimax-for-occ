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
    tts_model: Optional[str]
    system_prompt: str
    greeting: str
    rag_enabled: bool
    rag_top_k: int
    n8n_workflows: list[dict[str, Any]]
    org_id: Optional[str] = None
    # Custom hold music URL configured by the org (organizations.hold_music_url).
    # When set, the worker uses this URL instead of Twilio's default jingle while
    # the call is on hold. Resolved lazily from Supabase at session start.
    hold_music_url: Optional[str] = None


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
    """Try participant attributes first, fall back to room metadata.

    Attribute lookup order:
      1. ``agent_id`` — set by /api/token for browser/desk sessions.
      2. ``sip.h.x-lk-agent-id`` — for SIP/telephony calls, LiveKit exposes
         every forwarded SIP header as a participant attribute named
         ``sip.h.<lowercased-header>``, with the header's real VALUE. This is
         the reliable source of the agent UUID for campaign calls.
      3. ``axon.agent_id`` — the dispatch-rule attribute mapping. NOTE: this
         resolved to the literal header NAME "X-LK-Agent-Id" (not its value),
         so it's effectively useless; kept last and guarded below.

    Any value that still looks like a header name (starts with "X-LK-") is
    skipped — that's the broken-mapping artifact, not a real id.
    """
    if participant_attributes:
        for key in ("agent_id", "sip.h.x-lk-agent-id", "axon.agent_id"):
            aid = participant_attributes.get(key)
            if aid and not str(aid).startswith("X-LK-"):
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

            # Load the org's custom hold music URL (if any). The endpoint
            # /api/admin/hold-music writes to organizations.hold_music_url; the
            # worker reads it here so the runtime can pass it to Twilio when
            # placing a call on hold instead of falling back to the default
            # carrier jingle.
            hold_music_url: Optional[str] = None
            org_id = a.get("org_id")
            if org_id:
                try:
                    r3 = c.get(
                        _supabase_url(
                            f"/rest/v1/organizations?id=eq.{org_id}&select=hold_music_url"
                        )
                    )
                    r3.raise_for_status()
                    org_rows = r3.json() or []
                    if org_rows:
                        hold_music_url = org_rows[0].get("hold_music_url") or None
                except Exception:
                    logger.exception(
                        "failed to load hold_music_url for org %s", org_id
                    )
    except Exception:
        logger.exception("failed to load agent %s from supabase", agent_id)
        return None

    return AxonAgent(
        id=a["id"],
        name=a.get("name", "Agent"),
        language=a.get("language") or "multi",
        llm_provider=a.get("llm_provider") or "deepseek",
        llm_model=a.get("llm_model") or "deepseek-v4-flash",
        tts_voice_id=a.get("tts_voice_id"),
        tts_emotion=a.get("tts_emotion"),
        tts_speed=float(a.get("tts_speed") or 1.0),
        tts_model=a.get("tts_model"),
        system_prompt=(a.get("system_prompt") or DEFAULT_PROMPT).strip(),
        greeting=(a.get("greeting") or DEFAULT_GREETING).strip(),
        rag_enabled=bool(a.get("rag_enabled")),
        rag_top_k=int(a.get("rag_top_k") or 4),
        n8n_workflows=workflows,
        org_id=str(org_id) if org_id else None,
        hold_music_url=hold_music_url,
    )


def load_campaign_script(campaign_id: str) -> Optional[str]:
    """For a campaign call, fetch its reusable Script and render it as a
    prompt addendum the agent should follow during this conversation.

    Chain: campaigns.script_id → latest script_versions.steps. Returns None
    when the campaign has no script (agent just uses its base prompt), or on
    any error (script guidance is best-effort and must never block the call).

    The steps shape is [{step, title, content, branches?}] (see the Scripts
    editor). We flatten it into a readable numbered playbook.
    """
    if not has_supabase() or not campaign_id:
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0), headers=_supabase_headers()) as c:
            r = c.get(
                _supabase_url(
                    f"/rest/v1/campaigns?id=eq.{campaign_id}&select=script_id,name,scripts(name,mission)"
                )
            )
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return None
            campaign = rows[0]
            script_id = campaign.get("script_id")
            if not script_id:
                return None

            r2 = c.get(
                _supabase_url(
                    f"/rest/v1/script_versions?script_id=eq.{script_id}"
                    "&order=version.desc&limit=1&select=steps,version"
                )
            )
            r2.raise_for_status()
            versions = r2.json() or []
            if not versions:
                return None
            raw_steps = versions[0].get("steps")
            script_meta = campaign.get("scripts") or {}
            title = script_meta.get("name") or "Script"
            mission = script_meta.get("mission")

            lines: list[str] = []
            header = f"## Script à suivre : {title}"
            if mission:
                header += f" (objectif : {mission})"
            lines.append(header)
            lines.append(
                "Suis ce déroulé pendant l'appel. Adapte-toi naturellement aux "
                "réponses de l'interlocuteur ; les branches « Si … » indiquent "
                "vers quelle étape enchaîner selon ce qu'il répond."
            )

            # Two storage shapes: the new graph {nodes, edges} or the legacy
            # array [{step,title,content,branches:[{label,goto}]}].
            if isinstance(raw_steps, dict) and isinstance(raw_steps.get("nodes"), list):
                nodes = raw_steps.get("nodes") or []
                edges = raw_steps.get("edges") or []
                if not nodes:
                    return None
                title_by_id = {
                    n.get("id"): (n.get("title") or "").strip()
                    for n in nodes if isinstance(n, dict)
                }
                for idx, n in enumerate(nodes, start=1):
                    if not isinstance(n, dict):
                        continue
                    st_title = (n.get("title") or "").strip()
                    content = (n.get("content") or "").strip()
                    line = f"{idx}. {st_title}".strip(". ")
                    if content:
                        line += f" — {content}"
                    lines.append(line)
                    for e in edges:
                        if isinstance(e, dict) and e.get("source") == n.get("id"):
                            cond = (e.get("condition") or "").strip()
                            tgt = title_by_id.get(e.get("target"), "?")
                            if cond:
                                lines.append(f"   • {cond} → « {tgt} »")
                return "\n".join(lines)

            steps = raw_steps if isinstance(raw_steps, list) else []
            if not steps:
                return None
            for s in steps:
                if not isinstance(s, dict):
                    continue
                num = s.get("step", "")
                st_title = (s.get("title") or "").strip()
                content = (s.get("content") or "").strip()
                line = f"{num}. {st_title}".strip(". ")
                if content:
                    line += f" — {content}"
                lines.append(line)
                for b in s.get("branches") or []:
                    if isinstance(b, dict) and b.get("label"):
                        goto = b.get("goto")
                        lines.append(f"   • Si « {b['label']} » → étape {goto}")
            return "\n".join(lines)
    except Exception:
        logger.exception("failed to load campaign script for %s", campaign_id)
        return None


def rag_search(agent_id: str, query: str, top_k: int = 4) -> list[dict[str, Any]]:
    """Embed `query` via DeepSeek and call the match_documents RPC for `agent_id`."""
    if not has_supabase():
        return []
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        return []
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0)) as c:
            emb = c.post(
                f"{base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": "deepseek-embedding", "input": query},
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
