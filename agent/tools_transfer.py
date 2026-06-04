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


def _app_base_url() -> Optional[str]:
    """Mirror db_writes.trigger_post_call_pipeline's URL resolution."""
    base = (
        os.getenv("NEXT_PUBLIC_APP_URL")
        or (f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else None)
    )
    return base.rstrip("/") if base else None


def _stamp_disposition(call_id: Optional[str]) -> None:
    """Best-effort: set calls.disposition='transfer_humain' so the desk's
    Pool partagé picks the call up via its disposition ilike %humain% filter.
    Never raises."""
    if not call_id or not has_supabase():
        return
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={"disposition": _DISPOSITION_VALUE},
            )
            r.raise_for_status()
    except Exception:
        logger.exception("stamp disposition transfer_humain failed (call=%s)", call_id)


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
            "Use when the patient asks for an appointment, has a complex "
            "question that requires a human, asks to be called back by a "
            "person, or any situation where a human follow-up is more "
            "appropriate than continuing with the AI. The patient will be "
            "called by a human team member on the next business day."
        ),
    )
    async def transfer_to_human(
        qualification: Annotated[
            str,
            (
                "Short label of what the patient wants. One of: "
                "'RDV demandé', 'Question complexe', 'Rappel demandé', 'Autre'."
            ),
        ],
        reason: Annotated[
            str,
            (
                "1-2 sentences explaining why a human should call the patient "
                "back. Include any context the human will need (e.g. preferred "
                "time, what the patient asked about)."
            ),
        ],
    ) -> str:
        """Schedule a human follow-up call for the next business day.

        Returns a short French confirmation the LLM can read out. Never blocks
        the call: on HTTP failure we still confirm to the patient and log a
        warning, on success we log the task id.
        """
        payload = {
            "org_id": org_id,
            "contact_id": contact_id,
            "original_call_id": call_id,
            "transferred_by_agent_id": agent_handle_id,
            "qualification": qualification,
            "reason": reason,
        }
        ok, task_id, err = await _post_transfer(
            base_url=base_url, token=token, payload=payload,
        )
        if ok:
            logger.info(
                'transfer_to_human: task=%s qualification="%s" reason="%s"',
                task_id, qualification, (reason or "")[:200],
            )
        else:
            logger.warning(
                'transfer_to_human: POST failed (%s) — qualification="%s" reason="%s"',
                err, qualification, (reason or "")[:200],
            )

        # Fallback path: even if the human_callback_task insert ever fails,
        # stamping the disposition makes the call surface in the desk's
        # "Pool partagé" (which filters disposition ilike %humain%). Best
        # effort — runs in a thread so we don't block the response.
        try:
            await asyncio.to_thread(_stamp_disposition, call_id)
        except Exception:
            # Should never happen — _stamp_disposition swallows its own errors.
            logger.exception("transfer_to_human: stamp_disposition raised")

        return (
            "C'est noté, un membre de notre équipe vous rappellera demain "
            "à propos de votre demande. Avez-vous d'autres questions en "
            "attendant ?"
        )

    return transfer_to_human
