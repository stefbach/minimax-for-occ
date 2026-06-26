"""`schedule_callback` LiveKit function tool (Wati 26/06).

When a patient asks the IA (Charlotte) to be called back at a SPECIFIC date and
time, Charlotte calls this tool. We POST to `/api/agent-tools/schedule-callback`,
which stamps the lead's `leads_rdv` row with `qualification = 'RAPPEL'` and
`rappel_rdv = <requested time, UTC>`. The dialer's exact-time callback runner
then places the outbound call (via Charlotte prod) at that time — clamped to
08:00–21:00 UK.

This is DISTINCT from `transfer_to_human`:
  • transfer_to_human  → a HUMAN calls the patient back (human_callback_tasks).
  • schedule_callback   → CHARLOTTE (the IA) calls the patient back at the
                          requested time (leads_rdv RAPPEL + rappel_rdv).

Design mirrors tools_transfer.py: bearer-auth POST to the web side (no direct
Supabase schema logic here), fail-soft registration, never raise into the call.
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Optional

import httpx

logger = logging.getLogger("axon.tools.schedule_callback")


def _app_base_url() -> Optional[str]:
    base = (
        os.getenv("NEXT_PUBLIC_APP_URL")
        or (f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else None)
    )
    return base.rstrip("/") if base else None


async def _post_schedule(
    *, base_url: str, token: str, payload: dict, timeout: float = 10.0,
) -> tuple[bool, dict]:
    """POST to /api/agent-tools/schedule-callback. Returns (ok, data). Never raises."""
    url = f"{base_url}/api/agent-tools/schedule-callback"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as c:
            r = await c.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            return False, {"error": f"HTTP {r.status_code}: {r.text[:200]}"}
        try:
            return True, (r.json() if r.content else {})
        except Exception:
            return False, {"error": "non-JSON response"}
    except Exception as exc:  # noqa: BLE001
        return False, {"error": f"{type(exc).__name__}: {exc}"}


def _confirmation(language: Optional[str], date: str, time: str) -> str:
    """Spoken confirmation read back to the patient."""
    lang = (language or "").strip().lower()
    if lang.startswith("en"):
        return (
            f"Perfect — I've scheduled a callback for {date} at {time}. "
            "We'll call you then. Is there anything else I can help you with?"
        )
    return (
        f"Parfait, je vous programme un rappel le {date} à {time}. "
        "Nous vous rappellerons à ce moment-là. Puis-je vous aider sur autre chose ?"
    )


def build_schedule_callback_tool(
    *,
    org_id: Optional[str],
    call_id: Optional[str],
    e164: Optional[str] = None,
    language: Optional[str] = None,
):
    """Return a livekit-agents function_tool, or None if it shouldn't register.

    Omitted when INTERNAL_AGENT_API_TOKEN / app URL is missing (same fail-soft
    contract as transfer_to_human). org_id is optional here — leads_rdv is a
    single-tenant table and the endpoint resolves the lead by phone — but we
    still forward it for parity / future multi-tenant scoping.
    """
    token = os.getenv("INTERNAL_AGENT_API_TOKEN")
    base_url = _app_base_url()
    if not token:
        logger.error("schedule_callback: INTERNAL_AGENT_API_TOKEN not set — tool disabled")
        return None
    if not base_url:
        logger.error("schedule_callback: NEXT_PUBLIC_APP_URL/VERCEL_URL not set — tool disabled")
        return None

    from livekit.agents import function_tool

    @function_tool(
        name="schedule_callback",
        description=(
            "Call this when the patient asks YOU (the AI) to call them back at a "
            "SPECIFIC date and time — e.g. 'call me back tomorrow at 2pm', "
            "'rappelez-moi mardi à 14h'. This schedules an automatic callback "
            "that YOU will place at that time. Use this (NOT transfer_to_human) "
            "when the patient is happy to keep talking to the assistant but just "
            "wants a different moment. Pass the concrete date (YYYY-MM-DD) and "
            "time (HH:MM, 24-hour). Calls go out 08:00–21:00 UK; a time outside "
            "that is moved to the nearest bound."
        ),
    )
    async def schedule_callback(
        callback_date: Annotated[
            str,
            "The requested callback date as YYYY-MM-DD (resolve relative dates "
            "like 'tomorrow'/'demain' to a concrete date).",
        ],
        callback_time: Annotated[
            str,
            "The requested callback time as HH:MM in 24-hour format (e.g. '14:30'). "
            "Interpreted as UK local time.",
        ],
        reason: Annotated[
            str,
            "Short note on why / what the callback is about, for context.",
        ] = "",
    ) -> str:
        payload = {
            "org_id": org_id,
            "e164": e164,
            "original_call_id": call_id,
            "date": callback_date,
            "time": callback_time,
            "reason": reason,
        }
        ok, data = await _post_schedule(base_url=base_url, token=token, payload=payload)
        if ok and data.get("ok"):
            logger.info(
                "schedule_callback: scheduled_for=%s matched=%s reason=%r",
                data.get("scheduled_for"), data.get("matched"), (reason or "")[:160],
            )
        elif ok and not data.get("ok"):
            # Reached the server but no lead matched the phone — log so ops see it.
            logger.warning(
                "schedule_callback: no lead matched (scheduled_for=%s) — reason=%r",
                data.get("scheduled_for"), (reason or "")[:160],
            )
        else:
            logger.warning("schedule_callback: POST failed (%s)", data.get("error"))

        # Always confirm to the patient — a server hiccup must not break the call.
        return _confirmation(language, callback_date, callback_time)

    return schedule_callback
