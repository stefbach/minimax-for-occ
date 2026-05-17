"""Supabase write helpers for the LiveKit worker.

Thin wrappers over the Supabase REST API. Each helper logs and
swallows errors — the call shouldn't die just because we failed to
record a telemetry event.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from agent_config import _supabase_headers, _supabase_url, has_supabase

logger = logging.getLogger("axon.db_writes")


def append_call_event(
    call_id: Optional[str],
    kind: str,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    """Insert a row into public.call_events.

    No-ops if Supabase isn't configured or `call_id` is missing — useful
    for local dev where the worker may be started without a real call
    record (e.g. `python agent.py dev`).
    """
    if not call_id:
        logger.debug("append_call_event(%s) skipped — no call_id", kind)
        return
    if not has_supabase():
        logger.debug("append_call_event(%s) skipped — no supabase env", kind)
        return
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.post(
                _supabase_url("/rest/v1/call_events"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={
                    "call_id": call_id,
                    "kind": kind,
                    "payload": payload or {},
                },
            )
            r.raise_for_status()
    except Exception:
        logger.exception("append_call_event failed (call=%s kind=%s)", call_id, kind)


def update_call_metadata(call_id: Optional[str], patch: dict[str, Any]) -> None:
    """Shallow-merge `patch` into calls.metadata for the given call."""
    if not call_id or not has_supabase():
        return
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.get(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}&select=metadata"),
            )
            r.raise_for_status()
            rows = r.json() or []
            current = (rows[0].get("metadata") if rows else {}) or {}
            merged = {**current, **patch}
            r2 = c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={"metadata": merged},
            )
            r2.raise_for_status()
    except Exception:
        logger.exception("update_call_metadata failed (call=%s)", call_id)


def update_call_recording_url(call_id: Optional[str], url: str) -> None:
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
                json={"recording_url": url},
            )
            r.raise_for_status()
    except Exception:
        logger.exception("update_call_recording_url failed (call=%s)", call_id)
