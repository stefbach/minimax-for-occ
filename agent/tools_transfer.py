"""`transfer_to_human` LiveKit function tool.

When the AI agent decides mid-call that the patient needs a human follow-up
(books an RDV, complex objection, asks to be called back), it calls this tool.
We POST to the Next.js endpoint `/api/agent-tools/transfer-to-human`, which
inserts a `human_callback_task` scheduled for the next business day.

Design notes:
  • The endpoint already exists and is authenticated via a bearer
    `INTERNAL_AGENT_API_TOKEN` shared secret. We never call Supabase directly
    from here — keep the schema-aware logic on the web side.
  • Never raise into the call. On HTTP error we log a warning and still return
    a polite confirmation to the patient — a server hiccup must not break the
    voice experience.
  • Fail-soft on missing env vars: `build_transfer_to_human_tool()` returns
    `None` so older deployments without the bearer secret simply don't
    register the tool (rather than crashing on first invocation).
  • As a fallback path for the desk dashboard ("Pool partagé"), we also stamp
    `calls.disposition = 'transfer_humain'` so even if the human_callback_task
    insert ever fails, the call still surfaces in the shared queue.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Annotated, Optional

import httpx

from agent_config import _supabase_headers, _supabase_url, has_supabase

logger = logging.getLogger("axon.tools.transfer_to_human")


# Disposition stamped on the call row so the desk's "Pool partagé" picks it up
# as a fallback if the human_callback_task insert ever failed.
_DISPOSITION_VALUE = "transfer_humain"

# OCC's standard qualification for "this patient needs a human to follow up".
# Mirrors the values db_writes.auto_qualify_call writes so the dashboard,
# /desk queue and leads_rdv writeback all agree. Anything else (RAPPEL,
# RDV CONFIRME, etc.) is set through save_contact_data, not this tool —
# transfer_to_human is the single, deterministic "give it to a human" path.
_OCC_HANDOFF_QUALIFICATION = "A PASSER A L'HUMAIN"


def _app_base_url() -> Optional[str]:
    """Mirror db_writes.trigger_post_call_pipeline's URL resolution."""
    base = (
        os.getenv("NEXT_PUBLIC_APP_URL")
        or (f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else None)
    )
    return base.rstrip("/") if base else None


def _stamp_disposition_and_qualification(call_id: Optional[str]) -> None:
    """Best-effort: set calls.disposition='transfer_humain' AND
    calls.metadata.qualification='A PASSER A L'HUMAIN' so:
      • the desk's Pool partagé picks the call via its disposition ilike
        %humain% filter (legacy path),
      • the dashboard's qualification bucket lights up correctly,
      • the leads_rdv writeback (sync-lead) carries the OCC standard
        qualification straight onto the lead row instead of whatever
        heuristic auto_qualify_call would have inferred.

    We do BOTH writes in a single PATCH so they can't drift. Never raises.
    """
    if not call_id or not has_supabase():
        return
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            # Read current metadata so the qualification merge doesn't drop
            # anything previous turns (campaign_id, target_id, source) wrote.
            r0 = c.get(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}&select=metadata"),
            )
            r0.raise_for_status()
            rows = r0.json() or []
            current_meta = rows[0].get("metadata") if rows else None
            merged_meta = {
                **(current_meta if isinstance(current_meta, dict) else {}),
                "qualification": _OCC_HANDOFF_QUALIFICATION,
                "qualification_source": "transfer_to_human",
            }
            r = c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={
                    "disposition": _DISPOSITION_VALUE,
                    "metadata": merged_meta,
                },
            )
            r.raise_for_status()
    except Exception:
        logger.exception(
            "stamp disposition + qualification failed (call=%s)", call_id,
        )


async def _post_transfer(
    *,
    base_url: str,
    token: str,
    payload: dict,
    timeout: float = 10.0,
) -> tuple[bool, Optional[str], Optional[str]]:
    """POST to /api/agent-tools/transfer-to-human.

    Returns (ok, task_id, error_message). Never raises — converts every
    exception path into (False, None, str(exc)).
    """
    url = f"{base_url}/api/agent-tools/transfer-to-human"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as c:
            r = await c.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if r.status_code >= 400:
            return False, None, f"HTTP {r.status_code}: {r.text[:200]}"
        try:
            data = r.json()
        except Exception:
            return False, None, "non-JSON response"
        task_id = data.get("task_id") if isinstance(data, dict) else None
        return True, task_id, None
    except Exception as exc:  # noqa: BLE001 - want to swallow all networking errors
        return False, None, f"{type(exc).__name__}: {exc}"


def build_transfer_to_human_tool(
    *,
    org_id: Optional[str],
    contact_id: Optional[str],
    call_id: Optional[str],
    agent_handle_id: Optional[str],
):
    """Return a livekit-agents function_tool, or None if it should not be
    registered for this session.

    The tool is omitted (not registered) when:
      • INTERNAL_AGENT_API_TOKEN is not set — auth would always 401.
      • NEXT_PUBLIC_APP_URL / VERCEL_URL is not set — nowhere to POST to.
      • org_id is missing — every action carries the tenant id; without it
        the endpoint would reject the request.

    In any of those cases we log ONCE at boot so older deployments don't
    crash, they just silently lack the human-callback path.
    """
    token = os.getenv("INTERNAL_AGENT_API_TOKEN")
    base_url = _app_base_url()
    if not token:
        logger.error(
            "transfer_to_human: INTERNAL_AGENT_API_TOKEN not set — tool disabled"
        )
        return None
    if not base_url:
        logger.error(
            "transfer_to_human: NEXT_PUBLIC_APP_URL/VERCEL_URL not set — tool disabled"
        )
        return None
    if not org_id:
        logger.warning(
            "transfer_to_human: no org_id for this session — tool disabled"
        )
        return None

    from livekit.agents import function_tool

    @function_tool(
        name="transfer_to_human",
        description=(
            "Call this IMMEDIATELY whenever the patient asks to speak to a "
            "real person, says they don't want to talk to a bot, or any "
            "equivalent — and also when their request is something the AI "
            "cannot resolve (complex medical question, billing dispute, "
            "anything outside this call's scope). Do not try to convince "
            "them otherwise. A human team member will call them back on the "
            "next business day. Always pass a short `reason` so the human "
            "starts briefed."
        ),
    )
    async def transfer_to_human(
        reason: Annotated[
            str,
            (
                "1-2 sentences for the human team-mate explaining why the "
                "patient needs a callback. Include any concrete context: what "
                "they asked, preferred callback time, language preference, "
                "emotional state, etc. This becomes the note attached to the "
                "callback task on the agent's desk."
            ),
        ],
    ) -> str:
        """Schedule a human follow-up call for the next business day.

        Always tagged with OCC qualification `A PASSER A L'HUMAIN` so it
        surfaces consistently across the dashboard, /desk Pool partagé, and
        the leads_rdv writeback. Returns a short French confirmation the LLM
        can read out. Never blocks the call: on HTTP failure we still confirm
        to the patient and log a warning.
        """
        payload = {
            "org_id": org_id,
            "contact_id": contact_id,
            "original_call_id": call_id,
            "transferred_by_agent_id": agent_handle_id,
            "qualification": _OCC_HANDOFF_QUALIFICATION,
            "reason": reason,
        }
        ok, task_id, err = await _post_transfer(
            base_url=base_url, token=token, payload=payload,
        )
        if ok:
            logger.info(
                'transfer_to_human: task=%s qualification="%s" reason="%s"',
                task_id, _OCC_HANDOFF_QUALIFICATION, (reason or "")[:200],
            )
        else:
            logger.warning(
                'transfer_to_human: POST failed (%s) — reason="%s"',
                err, (reason or "")[:200],
            )

        # Always stamp the call too so the qualification is on calls.metadata
        # even if the human_callback_task insert ever failed. Best effort —
        # runs in a thread so we don't block the response.
        try:
            await asyncio.to_thread(_stamp_disposition_and_qualification, call_id)
        except Exception:
            logger.exception(
                "transfer_to_human: stamp_disposition_and_qualification raised"
            )

        return (
            "C'est noté, un membre de notre équipe vous rappellera demain "
            "à propos de votre demande. Avez-vous d'autres questions en "
            "attendant ?"
        )

    return transfer_to_human
