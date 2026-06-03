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
from typing import Any, Optional

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


def _patch_room_metadata_handoff_target(
    room, *, target_handle_id: str, target_user_id: str, target_kind: str
):
    """Patch room metadata for a HUMAN handoff (desk path). Mirrors the keys
    written by /api/calls/[id]/handoff so the desk + worker can react. May
    return a coroutine — caller should await if so."""
    try:
        raw = getattr(room, "metadata", None) or "{}"
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        data["handoff_to"] = target_handle_id
        data["handoff_to_kind"] = target_kind
        data["handoff_to_user_id"] = target_user_id
        new_raw = json.dumps(data)
        local = getattr(room, "local_participant", None)
        for owner in (local, room):
            for fn_name in ("update_metadata", "set_metadata"):
                fn = getattr(owner, fn_name, None) if owner is not None else None
                if callable(fn):
                    try:
                        return fn(new_raw)
                    except Exception:
                        logger.exception(
                            "patching room metadata via %s failed", fn_name
                        )
    except Exception:
        logger.exception("_patch_room_metadata_handoff_target failed")
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

    # The real swap: the transfer tool and the persona-swap watcher live in the
    # SAME worker process. Room metadata written from the worker's participant
    # does NOT change ROOM metadata, so the metadata-based signal never reaches
    # the watcher (that's why the voice never changed). Trigger the swap
    # directly, in-process.
    if not _trigger_local_handoff(room, new_agent_id):
        logger.warning(
            "emit_handoff: no in-process handoff handler for room=%s — "
            "persona swap will not happen", getattr(room, "name", "?")
        )


# ─── In-process handoff bridge ────────────────────────────────────────────
# Maps a room name → a callback that performs the persona swap. Registered by
# the worker's handoff watcher, called by the transfer/handoff tools.
_LOCAL_HANDOFF_HANDLERS: dict[str, Any] = {}


def register_local_handoff_handler(room_key: str, handler) -> None:
    if room_key:
        _LOCAL_HANDOFF_HANDLERS[room_key] = handler


def unregister_local_handoff_handler(room_key: str) -> None:
    _LOCAL_HANDOFF_HANDLERS.pop(room_key, None)


def _trigger_local_handoff(room, new_agent_id: str) -> bool:
    key = getattr(room, "name", "") or ""
    cb = _LOCAL_HANDOFF_HANDLERS.get(key)
    if not cb:
        return False
    try:
        cb(str(new_agent_id))
        return True
    except Exception:
        logger.exception("local handoff handler failed")
        return False


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


# ─── Script-driven handoff: AI persona swap OR SIP transfer to a human ────
def _fetch_handle(handle_id: str) -> Optional[dict]:
    """Best-effort fetch of one agent_handle row by id."""
    if not has_supabase():
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(
                f"/rest/v1/agent_handles?id=eq.{handle_id}"
                "&select=id,kind,ai_agent_id,display_name,transfer_e164,active,user_id,org_id"
            ))
            r.raise_for_status()
            rows = r.json() or []
            return rows[0] if rows else None
    except Exception:
        logger.exception("_fetch_handle failed for %s", handle_id)
        return None


def _human_is_available(user_id: str, org_id: str) -> bool:
    """Check `human_presence` to see if a human agent is currently logged in
    on the desk and marked `available`. Used to choose between WebRTC handoff
    (route the call to their open desk session) and PSTN REFER fallback."""
    if not has_supabase() or not user_id:
        return False
    try:
        with httpx.Client(timeout=httpx.Timeout(3.0), headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(
                f"/rest/v1/human_presence?user_id=eq.{user_id}"
                f"&org_id=eq.{org_id}&select=status,last_seen&limit=1"
            ))
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return False
            return (rows[0].get("status") or "").lower() == "available"
    except Exception:
        logger.exception("_human_is_available failed for %s", user_id)
        return False


def _assign_call_to_handle(room_name: str, handle_id: str) -> bool:
    """Reassign `calls.agent_handle_id` for the call currently in `room_name`
    so the desk's realtime subscription notifies the targeted human. Returns
    True on success. Best-effort: failure is logged but never thrown."""
    if not has_supabase() or not room_name or not handle_id:
        return False
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.patch(
                _supabase_url(f"/rest/v1/calls?room_id=eq.{room_name}"),
                headers={**_supabase_headers(), "Content-Type": "application/json",
                         "Prefer": "return=minimal"},
                json={"agent_handle_id": handle_id},
            )
            r.raise_for_status()
            return True
    except Exception:
        logger.exception("_assign_call_to_handle failed for room=%s", room_name)
        return False


def _find_sip_participant_identity(room) -> Optional[str]:
    """Return the identity of the room's SIP participant (the PSTN callee),
    or None if no SIP party is connected. Used to target SIP transfers."""
    try:
        for p in (getattr(room, "remote_participants", {}) or {}).values():
            ident = getattr(p, "identity", "") or ""
            if ident.startswith("pstn-") or ident.startswith("sip_"):
                return ident
    except Exception:
        logger.exception("_find_sip_participant_identity failed")
    return None


def build_handoff_to_handle_tool(room, *, current_handle_id: Optional[str] = None):
    """LiveKit function_tool: `handoff_to_handle(handle_id, reason)`.

    Lets the LLM hand the active call to another agent_handle as the script
    flow dictates:
      • kind=ai  → publish swarm_handoff + flip room metadata `handoff_to`
                   → existing watcher in agent.py hot-swaps the persona.
      • kind=human → call LiveKit `TransferSIPParticipant` with the handle's
                     `transfer_e164` → the PSTN leg is REFERed to the human's
                     phone, the human picks up as if it were a normal call.

    Returns None if Supabase isn't configured — never blocks the call.
    """
    if not has_supabase():
        return None

    from livekit.agents import function_tool

    @function_tool
    async def handoff_to_handle(handle_id: str, reason: str = "") -> str:
        """Pass the active call to another agent (AI persona swap OR SIP
        transfer to a human). Use this when the script's current step is
        owned by a different agent_handle than the one currently speaking.

        Args:
            handle_id: The agent_handle UUID listed on the script step.
            reason: Short reason for the transfer (logged, shown in metadata).
        """
        if not handle_id:
            return "Erreur: handle_id manquant."
        if current_handle_id and handle_id == current_handle_id:
            return "Tu es déjà cet agent — pas besoin de transférer."

        h = _fetch_handle(handle_id)
        if not h:
            return f"Agent handle {handle_id} introuvable."
        kind = h.get("kind")
        name = h.get("display_name") or handle_id

        if kind == "ai":
            ai_agent_id = h.get("ai_agent_id")
            if not ai_agent_id:
                return f"Agent IA « {name} » mal configuré (pas d'ai_agent_id)."
            try:
                await emit_handoff(room, str(ai_agent_id), reason=reason or None)
                logger.info("handoff_to_handle → AI %s (%s)", name, ai_agent_id)
                return f"Passage à l'agent IA « {name} » effectué."
            except Exception as e:
                logger.exception("AI handoff failed")
                return f"Échec du passage à {name}: {e}"

        if kind == "human":
            room_name = getattr(room, "name", "") or ""
            user_id = h.get("user_id")
            org_id = h.get("org_id")

            # Preferred path: the human is logged in on the desk → reassign the
            # call to their handle so their browser softphone is notified via
            # the existing realtime subscription on `calls`. The desk then
            # joins this very room over WebRTC — no PSTN REFER, no extra fees,
            # and the IA can stay until the human is connected.
            if user_id and org_id and _human_is_available(str(user_id), str(org_id)):
                assigned = _assign_call_to_handle(room_name, str(h.get("id") or handle_id))
                try:
                    # Also flip room metadata so any in-room listener (the
                    # worker's handoff watcher, the desk UI) sees the target.
                    res = _patch_room_metadata_handoff_target(
                        room,
                        target_handle_id=str(h.get("id") or handle_id),
                        target_user_id=str(user_id),
                        target_kind="human",
                    )
                    if hasattr(res, "__await__"):
                        await res  # type: ignore[func-returns-value]
                except Exception:
                    logger.exception("room metadata patch (human handoff) failed")
                logger.info(
                    "handoff_to_handle → HUMAN (desk) %s (user_id=%s, assigned=%s)",
                    name, user_id, assigned,
                )
                return (
                    f"« {name} » est en ligne sur son poste — appel routé vers "
                    "son navigateur. Annonce-le brièvement puis raccroche ton "
                    "tour de parole pour la laisser prendre le relais."
                )

            # Fallback: PSTN transfer via SIP REFER → rings their mobile.
            phone = (h.get("transfer_e164") or "").strip()
            if not phone:
                return (
                    f"« {name} » n'est pas connecté(e) sur son poste et n'a pas "
                    "de numéro de transfert configuré. Impossible de la joindre "
                    "pour l'instant — continue toi-même ou propose un rappel."
                )
            sip_identity = _find_sip_participant_identity(room)
            if not sip_identity:
                return "Aucun participant SIP dans la salle à transférer."
            try:
                from livekit import api as lkapi_pkg  # type: ignore
                lkapi = lkapi_pkg.LiveKitAPI(
                    os.environ["LIVEKIT_URL"],
                    os.environ["LIVEKIT_API_KEY"],
                    os.environ["LIVEKIT_API_SECRET"],
                )
                try:
                    await lkapi.sip.transfer_sip_participant(
                        lkapi_pkg.TransferSIPParticipantRequest(
                            participant_identity=sip_identity,
                            room_name=room_name,
                            transfer_to=f"tel:{phone}",
                            play_dialtone=False,
                        )
                    )
                finally:
                    try:
                        await lkapi.aclose()
                    except Exception:
                        pass
                logger.info("handoff_to_handle → HUMAN %s (%s)", name, phone)
                return f"Appel transféré à {name} ({phone})."
            except Exception as e:
                logger.exception("SIP transfer failed")
                return f"Échec du transfert SIP vers {name}: {e}"

        return f"Type d'agent inconnu pour « {name} »: {kind}"

    return handoff_to_handle
