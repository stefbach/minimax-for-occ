"""Multi-agent swarm primitives.

When an agent is a member of an agent_team, it can call the
`transfer_to_specialist` LiveKit function tool to hand the conversation
over to a sibling agent in the same room. A single agent speaks at any
time; the others are simply not loaded into the AgentSession.

Wire flow:
  1. The LLM, faced with a user question outside its specialty, calls
     `transfer_to_specialist(specialty="billing")`.
  2. The tool queries Supabase for agent_team_members rows whose team
     contains the current agent_id AND whose specialty matches.
  3. It picks the highest-priority (lowest int) match, publishes a
     `swarm_handoff` data message in the room, and patches the room
     metadata's `handoff_to` field. The existing handoff watcher in
     agent.py then hot-swaps LLM + TTS to the target persona.
  4. If no team / no match, the tool returns a clean error so the LLM
     can apologize gracefully — never blocks the call.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger("axon.swarm")


@dataclass
class TeamMember:
    member_id: str
    agent_id: str
    team_id: str
    specialty: Optional[str]
    transfer_description: Optional[str]
    priority: int


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


def list_team_specialists(agent_id: str) -> list[TeamMember]:
    """Return the sibling specialists of `agent_id` across every team it belongs to.

    Excludes `agent_id` itself. Empty list = not in any team OR no siblings.
    """
    if not has_supabase():
        return []
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0), headers=_supabase_headers()) as c:
            # First: which teams is this agent part of?
            r = c.get(
                _supabase_url(
                    f"/rest/v1/agent_team_members?agent_id=eq.{agent_id}&select=team_id"
                )
            )
            r.raise_for_status()
            team_ids = [row["team_id"] for row in r.json() or []]
            if not team_ids:
                return []
            team_filter = ",".join(team_ids)
            r2 = c.get(
                _supabase_url(
                    f"/rest/v1/agent_team_members"
                    f"?team_id=in.({team_filter})"
                    f"&agent_id=neq.{agent_id}"
                    f"&select=id,team_id,agent_id,specialty,transfer_description,priority"
                    f"&order=priority.asc"
                )
            )
            r2.raise_for_status()
            return [
                TeamMember(
                    member_id=row["id"],
                    team_id=row["team_id"],
                    agent_id=row["agent_id"],
                    specialty=row.get("specialty"),
                    transfer_description=row.get("transfer_description"),
                    priority=int(row.get("priority") or 1),
                )
                for row in r2.json() or []
            ]
    except Exception:
        logger.exception("list_team_specialists failed for %s", agent_id)
        return []


def find_specialist(agent_id: str, specialty: str) -> Optional[TeamMember]:
    """Find the best (lowest-priority) sibling with the requested specialty."""
    target = (specialty or "").strip().lower()
    if not target:
        return None
    for m in list_team_specialists(agent_id):
        if m.specialty and m.specialty.strip().lower() == target:
            return m
    return None


def _patch_room_metadata(room, new_agent_id: str):
    """Patch the LiveKit room metadata so the existing watcher in agent.py
    hot-swaps the persona. Safe-no-op if the local SDK lacks the API.

    May return a coroutine — caller should `await` if so.
    """
    try:
        raw = getattr(room, "metadata", None) or "{}"
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        data["handoff_to"] = new_agent_id
        new_raw = json.dumps(data)
        local = getattr(room, "local_participant", None)
        # Newer versions: room.local_participant.update_metadata. Some forks
        # expose room.set_metadata or room.update_metadata. Try a few.
        for owner in (local, room):
            for fn_name in ("update_metadata", "set_metadata"):
                fn = getattr(owner, fn_name, None) if owner is not None else None
                if callable(fn):
                    try:
                        return fn(new_raw)
                    except Exception:
                        logger.exception("patching room metadata via %s failed", fn_name)
        logger.debug("no metadata-update API on this LiveKit SDK")
    except Exception:
        logger.exception("_patch_room_metadata failed")
    return None


async def emit_handoff(room, new_agent_id: str, *, reason: Optional[str] = None) -> None:
    """Publish a structured data message + flip room metadata so listeners
    (the JS front-end, the worker's metadata watcher) all converge on the
    new persona."""
    payload = {"type": "swarm_handoff", "new_agent_id": new_agent_id, "reason": reason}
    try:
        local = getattr(room, "local_participant", None)
        publish = (
            getattr(local, "publish_data", None) if local else None
        ) or getattr(room, "publish_data", None)
        if callable(publish):
            data = json.dumps(payload).encode("utf-8")
            try:
                res = publish(data, reliable=True, topic="swarm")
                if hasattr(res, "__await__"):
                    await res
            except TypeError:
                # Older sig: publish_data(data, kind, destination_sids)
                try:
                    res = publish(data)
                    if hasattr(res, "__await__"):
                        await res
                except Exception:
                    logger.exception("publish_data fallback failed")
    except Exception:
        logger.exception("emit_handoff: publish_data failed")

    try:
        res = _patch_room_metadata(room, new_agent_id)
        if res is not None and hasattr(res, "__await__"):
            await res
    except Exception:
        logger.exception("emit_handoff: metadata patch failed")


def build_transfer_tool(agent_id: Optional[str], room):
    """Construct a LiveKit function_tool that lets the LLM call
    `transfer_to_specialist(specialty=...)`. Returns None if the agent is
    not in any team — keeping the rest of the session strictly unaffected.
    """
    if not agent_id:
        return None
    siblings = list_team_specialists(agent_id)
    if not siblings:
        return None

    # Build a compact, LLM-visible roster so the tool description teaches
    # the model which specialties exist and what each is for.
    roster_lines: list[str] = []
    for m in siblings:
        bits = [f"- specialty={m.specialty or '(unknown)'}"]
        if m.transfer_description:
            bits.append(f"description={m.transfer_description}")
        bits.append(f"priority={m.priority}")
        roster_lines.append(" ".join(bits))
    roster = "\n".join(roster_lines) if roster_lines else "(no specialists configured)"

    try:
        from livekit.agents import function_tool
    except Exception:
        logger.exception("livekit.agents.function_tool not importable; swarm tool disabled")
        return None

    @function_tool
    async def transfer_to_specialist(specialty: str) -> str:
        """Hand the live conversation over to a specialist agent in the
        same call. The caller (user) stays connected; only your persona is
        swapped out. Use this when the user's request is clearly outside
        your scope but inside another team member's scope.

        Available specialists for this team:
        {roster}

        Args:
            specialty: One of the specialty labels listed above (e.g.
                "billing", "tech_support", "sales").
        """
        match = find_specialist(agent_id, specialty)
        if not match:
            return (
                f"No specialist with specialty='{specialty}' is available "
                f"in this team. Please handle it yourself or apologize."
            )
        try:
            await emit_handoff(room, match.agent_id, reason=f"specialty={match.specialty}")
        except Exception:
            logger.exception("transfer_to_specialist: handoff emit failed")
            return "Transfer attempted but the runtime could not switch persona."
        return (
            f"Transferred to specialist (agent_id={match.agent_id}, "
            f"specialty={match.specialty}). Stop responding; the next "
            f"turn will be handled by the new persona."
        )

    # Inject the live roster into the docstring at runtime so the LLM
    # actually sees it (function_tool reads __doc__).
    if transfer_to_specialist.__doc__:
        transfer_to_specialist.__doc__ = transfer_to_specialist.__doc__.replace("{roster}", roster)

    return transfer_to_specialist
