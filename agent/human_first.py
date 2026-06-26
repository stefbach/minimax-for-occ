"""Human-first inbound routing (Wati 25/06).

STRICTLY OPT-IN. Runs ONLY when env ``HUMAN_FIRST_INBOUND=1`` AND the call is
inbound (see the gate in agent.py:entrypoint). It never touches outbound calls.

When an inbound call lands on a number that has ONLINE human agents assigned
(``inbound_number_agents`` ∩ ``human_presence.status='available'``), we hand the
caller to a human by stamping the call row (``agent_handle_id`` + ``state`` +
``room_id``). The human's softphone — via the EXISTING desk realtime
subscription (Softphone.tsx) — rings and auto-joins this same LiveKit room, so
the human hears the caller. We then wait up to ``HUMAN_FIRST_WAIT_SECS`` for a
human participant to appear; if one does, the AI yields (entrypoint returns,
leaving human + caller in the room). Otherwise we clear the assignment and the
AI greets normally.

Known v1 limitations (to iterate during the LIVE test phase):
  * No hold audio yet — the caller hears brief silence during the ring window.
  * 1:1 longest-idle pick (no simultaneous ring-all pool).
  * Auto-join on the human side (no explicit Accept/Decline pop-up).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional
from urllib.parse import quote

import httpx

from db_writes import _supabase_url, _supabase_headers

WAIT_SECS = float(os.getenv("HUMAN_FIRST_WAIT_SECS", "18"))
_TIMEOUT = httpx.Timeout(5.0)


def _get(path: str) -> Any:
    """GET a PostgREST path, returning parsed JSON (or None on any failure)."""
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(path))
            if r.is_success:
                return r.json()
    except Exception:
        return None
    return None


def _patch_call(call_id: str, body: dict) -> bool:
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_supabase_headers()) as c:
            r = c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}"),
                headers={**_supabase_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"},
                json=body,
            )
            return r.is_success
    except Exception:
        return False


def _norm_e164(raw: Any) -> Optional[str]:
    """Normalise a SIP-provided number to +E.164, or None if it doesn't look
    like one. LiveKit usually hands a clean +44…; we strip spaces and a leading
    'sip:'/'tel:' wrapper just in case."""
    s = str(raw or "").strip()
    if not s:
        return None
    for pfx in ("sip:", "tel:"):
        if s.lower().startswith(pfx):
            s = s[len(pfx):]
    s = s.split("@", 1)[0].replace(" ", "")
    if s and not s.startswith("+") and s.isdigit():
        s = "+" + s
    return s if (s.startswith("+") and s[1:].isdigit() and 6 <= len(s) - 1 <= 15) else None


def _patch_call_if_null(call_id: str, col: str, val: str) -> None:
    """Set calls.<col>=val ONLY when it is currently NULL (PostgREST filter).
    Safe for outbound rows (already populated) — it only fills the gaps the
    inbound SIP path leaves behind. Never raises."""
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_supabase_headers()) as c:
            c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}&{col}=is.null"),
                headers={**_supabase_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"},
                json={col: val},
            )
    except Exception:
        pass


def _create_inbound_call_row(from_e164: Optional[str], to_e164: Optional[str], room_name: str) -> Optional[str]:
    """Create a calls row for a direct-SIP inbound call (trunk → LiveKit, no webhook).

    When the Twilio SIP trunk Origination URI points straight at LiveKit the
    voice-inbound webhook is never called, so no calls row is pre-created.
    This helper fills that gap: it looks up the phone_number by to_e164, checks
    that inbound is enabled, and inserts the row. Returns the new call UUID, or
    None on any failure.  Best-effort — the caller should log and continue."""
    if not to_e164:
        return None
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(
                f"/rest/v1/phone_numbers?e164=eq.{quote(to_e164, safe='')}"
                "&select=id,org_id,inbound_enabled&limit=1"
            ))
            if not r.is_success:
                return None
            pns = r.json()
            if not pns:
                return None
            pn = pns[0]
        if not pn.get("inbound_enabled"):
            return None
        with httpx.Client(timeout=_TIMEOUT, headers=_supabase_headers()) as c:
            r = c.post(
                _supabase_url("/rest/v1/calls"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                json={
                    "org_id": pn["org_id"],
                    "direction": "in",
                    "state": "ringing",
                    "from_e164": from_e164,
                    "to_e164": to_e164,
                    "phone_number_id": pn["id"],
                    "room_id": room_name,
                    "metadata": {"source": "sip_direct"},
                },
            )
            if not r.is_success:
                return None
            created = r.json()
            return created[0]["id"] if created else None
    except Exception:
        return None


def _lookup_inbound_agent_id(to_e164: Optional[str]) -> Optional[str]:
    """Return the ai_agent_id configured for this inbound number, or None.

    Used when the call arrived via the direct SIP trunk path (no webhook),
    so no X-LK-Agent-Id header was forwarded. We resolve Charlotte (or
    whichever persona) by following phone_numbers.agent_handle_id →
    agent_handles.ai_agent_id."""
    if not to_e164:
        return None
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(
                f"/rest/v1/phone_numbers?e164=eq.{quote(to_e164, safe='')}"
                "&select=agent_handle_id&limit=1"
            ))
            if not r.is_success:
                return None
            pns = r.json()
            if not pns or not pns[0].get("agent_handle_id"):
                return None
            handle_id = pns[0]["agent_handle_id"]
            r2 = c.get(_supabase_url(
                f"/rest/v1/agent_handles?id=eq.{handle_id}&select=ai_agent_id&limit=1"
            ))
            if not r2.is_success:
                return None
            handles = r2.json()
            if not handles:
                return None
            return handles[0].get("ai_agent_id") or None
    except Exception:
        return None


async def capture_inbound_numbers(call_id: str, from_raw: Any, to_raw: Any, clog: logging.Logger) -> Optional[str]:
    """Persist the caller (from) + dialed (to) E.164 on an inbound call row.

    Genuine inbound SIP calls arrive via the trunk with LiveKit's native
    ``sip.phoneNumber`` (caller) / ``sip.trunkPhoneNumber`` (dialed number), NOT
    the ``X-LK-*`` headers the dispatch rule maps — so calls.from_e164/to_e164
    stay NULL and per-number routing + the dashboard Entrants tab have nothing
    to key on. We fill the NULLs here. Returns the resolved to_e164 (dialed
    number) so the caller can drive per-number routing. Best-effort."""
    f = _norm_e164(from_raw)
    t = _norm_e164(to_raw)
    clog.info("[inbound] capture numbers from=%s to=%s (raw from=%r to=%r)", f, t, from_raw, to_raw)
    if f:
        await asyncio.to_thread(_patch_call_if_null, call_id, "from_e164", f)
    if t:
        await asyncio.to_thread(_patch_call_if_null, call_id, "to_e164", t)
    return t


def _lookup_inbound(call_id: str) -> Optional[dict]:
    """Resolve {org_id, to_e164, state, phone_number_id, inbound_enabled}."""
    rows = _get(f"/rest/v1/calls?id=eq.{call_id}&select=org_id,to_e164,state&limit=1")
    if not rows:
        return None
    call = rows[0]
    org_id = call.get("org_id")
    to_e164 = call.get("to_e164")
    if not org_id or not to_e164:
        return None
    pn = _get(
        f"/rest/v1/phone_numbers?org_id=eq.{org_id}&e164=eq.{quote(to_e164, safe='')}"
        "&select=id,inbound_enabled,human_first_enabled&limit=1"
    )
    if not pn:
        return None
    return {
        "org_id": org_id,
        "to_e164": to_e164,
        "state": call.get("state"),
        "phone_number_id": pn[0]["id"],
        "inbound_enabled": bool(pn[0].get("inbound_enabled")),
        "human_first_enabled": bool(pn[0].get("human_first_enabled")),
    }


def _online_assigned_handle(org_id: str, phone_number_id: str) -> Optional[str]:
    """agent_handles.id of the longest-idle ONLINE human assigned to this number."""
    assigned = _get(
        f"/rest/v1/inbound_number_agents?org_id=eq.{org_id}"
        f"&phone_number_id=eq.{phone_number_id}&select=user_id"
    )
    user_ids = [a["user_id"] for a in (assigned or []) if a.get("user_id")]
    if not user_ids:
        return None
    in_list = ",".join(user_ids)
    online = _get(
        f"/rest/v1/human_presence?org_id=eq.{org_id}&user_id=in.({in_list})"
        "&status=eq.available&select=user_id,last_inbound_at"
        "&order=last_inbound_at.asc.nullsfirst&limit=1"
    )
    if not online:
        return None
    pick_user = online[0]["user_id"]
    handles = _get(
        f"/rest/v1/agent_handles?org_id=eq.{org_id}&user_id=eq.{pick_user}"
        "&kind=eq.human&select=id&limit=1"
    )
    if not handles:
        return None
    return handles[0]["id"]


async def _wait_for_human(ctx, timeout: float) -> bool:
    """True as soon as a human participant (kind=human / identity human-*) joins."""
    loop = asyncio.get_event_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        for p in ctx.room.remote_participants.values():
            attrs = dict(getattr(p, "attributes", None) or {})
            ident = str(getattr(p, "identity", "") or "")
            if attrs.get("kind") == "human" or ident.startswith("human-"):
                return True
        await asyncio.sleep(0.5)
    return False


async def try_human_first(ctx, call_id: str, clog: logging.Logger) -> bool:
    """Ring an assigned online human first. Returns True if one took the call."""
    info = await asyncio.to_thread(_lookup_inbound, call_id)
    # Per-number "Humain d'abord" toggle: when off, the AI answers directly.
    if not info or not info["inbound_enabled"] or not info["human_first_enabled"]:
        return False
    handle_id = await asyncio.to_thread(
        _online_assigned_handle, info["org_id"], info["phone_number_id"]
    )
    if not handle_id:
        # Retry once after a short delay — the human may have just set themselves
        # "available" milliseconds before the call arrived and the DB write
        # may not have committed yet when we first checked.
        await asyncio.sleep(3)
        handle_id = await asyncio.to_thread(
            _online_assigned_handle, info["org_id"], info["phone_number_id"]
        )
    if not handle_id:
        clog.info("[human-first] no online human for %s — AI handles", info["to_e164"])
        return False

    room_name = ctx.room.name
    orig_state = info.get("state") or "active"

    assigned = await asyncio.to_thread(
        _patch_call,
        call_id,
        {"agent_handle_id": handle_id, "state": "ringing", "room_id": room_name},
    )
    if not assigned:
        return False
    clog.info(
        "[human-first] ringing human handle=%s on %s (wait %ss)",
        handle_id, info["to_e164"], WAIT_SECS,
    )

    if await _wait_for_human(ctx, WAIT_SECS):
        clog.info("[human-first] human joined — AI yields the call")
        return True

    # Timeout — hand the call back to the AI.
    await asyncio.to_thread(
        _patch_call, call_id, {"agent_handle_id": None, "state": orig_state}
    )
    clog.info("[human-first] no pickup after %ss — AI takes over", WAIT_SECS)
    return False
