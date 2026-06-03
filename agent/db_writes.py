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


def save_contact_data(
    contact_id: Optional[str],
    org_id: Optional[str],
    attributes_patch: dict[str, Any],
    *,
    display_name: Optional[str] = None,
    email: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict[str, Any]:
    """Merge `attributes_patch` into contacts.attributes for one contact and
    optionally update its display_name / email / notes.

    Used by the in-call `save_contact_data` agent tool so an agent can persist
    what it learns mid-conversation (BMI, DOB, eligibility, ...) onto the CRM
    contact row that the campaign is calling.

    Returns {"ok": True, "saved": [...keys...]} or {"ok": False, "error": ...}
    so the calling tool can report success to the LLM.

    org_id is required and used as a WHERE clause so a misrouted call can never
    write onto another tenant's contact.
    """
    if not has_supabase():
        return {"ok": False, "error": "supabase not configured"}
    if not contact_id:
        return {"ok": False, "error": "no contact_id for this call (manual/sim call?)"}
    if not org_id:
        return {"ok": False, "error": "no org_id resolved"}
    try:
        with httpx.Client(timeout=httpx.Timeout(8.0), headers=_supabase_headers()) as c:
            # Read current attributes so we shallow-merge instead of clobber.
            r = c.get(
                _supabase_url(
                    f"/rest/v1/contacts?id=eq.{contact_id}&org_id=eq.{org_id}"
                    "&select=attributes"
                ),
            )
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return {"ok": False, "error": "contact not found in this org"}
            current = rows[0].get("attributes") or {}
            if not isinstance(current, dict):
                current = {}
            # Drop None values so the agent can't accidentally wipe a field.
            clean_patch = {k: v for k, v in (attributes_patch or {}).items() if v is not None}
            merged = {**current, **clean_patch}

            body: dict[str, Any] = {"attributes": merged}
            if display_name is not None and str(display_name).strip():
                body["display_name"] = str(display_name).strip()
            if email is not None and str(email).strip():
                body["email"] = str(email).strip()
            if notes is not None and str(notes).strip():
                body["notes"] = str(notes).strip()

            r2 = c.patch(
                _supabase_url(
                    f"/rest/v1/contacts?id=eq.{contact_id}&org_id=eq.{org_id}"
                ),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=body,
            )
            r2.raise_for_status()
            saved_keys = sorted(clean_patch.keys()) + [
                k for k in ("display_name", "email", "notes") if k in body
            ]
            return {"ok": True, "saved": saved_keys}
    except Exception as exc:
        logger.exception("save_contact_data failed (contact=%s)", contact_id)
        return {"ok": False, "error": str(exc)}


def save_to_data_table(
    physical_table: Optional[str],
    row_id: Optional[str],
    fields: dict[str, Any],
) -> dict[str, Any]:
    """PATCH a row of a tenant data table (e.g. leads_rdv) by id, writing the
    provided fields to their REAL columns. Unknown columns are dropped by
    PostgREST? No — PostgREST errors on unknown columns, so we first read the
    table's column list and keep only matching keys.

    Used by the in-call save_contact_data tool when the campaign target came
    from a data table (source_metadata.physical_table / row_id).
    """
    if not has_supabase():
        return {"ok": False, "error": "supabase not configured"}
    if not physical_table or not row_id:
        return {"ok": False, "error": "no data-table row for this call"}
    # Basic guard against a malformed table name reaching the URL.
    import re as _re
    if not _re.match(r"^[a-z][a-z0-9_]{2,62}$", physical_table):
        return {"ok": False, "error": f"invalid table name {physical_table}"}
    try:
        with httpx.Client(timeout=httpx.Timeout(8.0), headers=_supabase_headers()) as c:
            # Introspect columns via a 1-row probe (limit=1) to learn valid keys.
            probe = c.get(
                _supabase_url(f"/rest/v1/{physical_table}?select=*&limit=1"),
            )
            probe.raise_for_status()
            sample = probe.json() or []
            valid_cols = set(sample[0].keys()) if sample else set(fields.keys())
            clean = {
                k: v for k, v in (fields or {}).items()
                if v is not None and k in valid_cols and k not in ("id", "created_at")
            }
            # Always bump updated_at if the column exists.
            if "updated_at" in valid_cols:
                from datetime import datetime, timezone
                clean["updated_at"] = datetime.now(timezone.utc).isoformat()
            if not clean:
                return {"ok": False, "error": "no matching columns to write"}
            r = c.patch(
                _supabase_url(f"/rest/v1/{physical_table}?id=eq.{row_id}"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=clean,
            )
            r.raise_for_status()
            return {"ok": True, "saved": sorted(k for k in clean if k != "updated_at")}
    except Exception as exc:
        logger.exception("save_to_data_table failed (%s/%s)", physical_table, row_id)
        return {"ok": False, "error": str(exc)}


def emit_qualification_webhooks(
    org_id: Optional[str],
    physical_table: Optional[str],
    row_id: Optional[str],
    fields: dict[str, Any],
    data_table_id: Optional[str] = None,
) -> None:
    """Notify n8n (or any configured endpoint) when the agent writes a watched
    column — typically `qualification` — during a call.

    This is how post-RDV automations fire: the user builds a workflow in the
    n8n "Workflows" section, exposes its webhook URL, registers it in Axon
    (org_webhooks), and we POST the row + new values here the moment the AI
    sets the qualification in-call. Fully column-mapped (watch_column +
    match_values are per-client config), so nothing is hardcoded to OCC.

    Fire-and-forget: never raises, never blocks the call.
    """
    if not org_id or not has_supabase() or not fields:
        return
    try:
        with httpx.Client(timeout=httpx.Timeout(6.0), headers=_supabase_headers()) as c:
            # Pull this org's active webhooks. We filter watch_column / table
            # match in Python to keep the query simple and the matching robust.
            q = (
                "/rest/v1/org_webhooks"
                "?select=id,url,event,data_table_id,watch_column,match_values,headers"
                f"&org_id=eq.{org_id}&active=eq.true"
            )
            r = c.get(_supabase_url(q))
            r.raise_for_status()
            hooks = r.json() or []
            if not hooks:
                return
            for h in hooks:
                col = h.get("watch_column") or "qualification"
                if col not in fields:
                    continue
                # Table scoping: NULL data_table_id => all tables for the org.
                hook_tbl = h.get("data_table_id")
                if hook_tbl and data_table_id and hook_tbl != data_table_id:
                    continue
                new_val = fields.get(col)
                matches = h.get("match_values") or []
                if matches and str(new_val) not in [str(m) for m in matches]:
                    continue
                payload = {
                    "event": h.get("event") or "qualification_changed",
                    "org_id": org_id,
                    "data_table": physical_table,
                    "data_table_id": data_table_id,
                    "row_id": row_id,
                    "watch_column": col,
                    "value": new_val,
                    "fields": fields,
                    "occurred_at": _now_iso(),
                }
                extra_headers = h.get("headers") if isinstance(h.get("headers"), dict) else {}
                try:
                    hr = c.post(
                        h["url"],
                        headers={"Content-Type": "application/json", **(extra_headers or {})},
                        json=payload,
                    )
                    logger.info(
                        "qualification webhook -> %s [%s] status=%s",
                        h.get("id"), h.get("event"), hr.status_code,
                    )
                except Exception as post_exc:  # one bad URL shouldn't stop the rest
                    logger.warning("qualification webhook %s POST failed: %s", h.get("id"), post_exc)
    except Exception:
        logger.exception("emit_qualification_webhooks failed (org=%s)", org_id)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def append_transcript_turn(
    call_id: Optional[str],
    speaker: str,
    text: str,
    *,
    seq: Optional[int] = None,
    speaker_id: Optional[str] = None,
    confidence: Optional[float] = None,
    language: Optional[str] = None,
    started_at: Optional[str] = None,
    ended_at: Optional[str] = None,
) -> None:
    """Insert a single transcript turn into public.call_transcripts.

    `seq` is auto-derived by the server-side API if omitted; this helper
    posts directly to PostgREST so we must supply one. We use a coarse
    monotonic counter via httpx to read the current max+1.
    """
    if not call_id or not has_supabase() or not text.strip():
        return
    from datetime import datetime, timezone

    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            if seq is None:
                r = c.get(
                    _supabase_url(
                        f"/rest/v1/call_transcripts?call_id=eq.{call_id}&select=seq&order=seq.desc&limit=1"
                    ),
                )
                r.raise_for_status()
                rows = r.json() or []
                last = rows[0].get("seq") if rows else None
                seq = (int(last) + 1) if isinstance(last, int) else 0

            now_iso = datetime.now(timezone.utc).isoformat()
            payload = {
                "call_id": call_id,
                "seq": seq,
                "speaker": speaker,
                "speaker_id": speaker_id,
                "text": text,
                "started_at": started_at or now_iso,
                "ended_at": ended_at,
                "confidence": confidence,
                "language": language,
            }
            r2 = c.post(
                _supabase_url("/rest/v1/call_transcripts"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=payload,
            )
            r2.raise_for_status()
    except Exception:
        logger.exception("append_transcript_turn failed (call=%s)", call_id)


def trigger_post_call_pipeline(call_id: Optional[str]) -> None:
    """Best-effort: ask the web app to generate the summary then run analyses.

    Uses NEXT_PUBLIC_APP_URL (or VERCEL_URL) so we hit the deployed API. If
    neither is set, we no-op — the front-end can also trigger this manually.
    """
    if not call_id:
        return
    base = (
        os.getenv("NEXT_PUBLIC_APP_URL")
        or (f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else None)
    )
    if not base:
        logger.debug("trigger_post_call_pipeline: no APP_URL — skipping")
        return
    base = base.rstrip("/")
    headers = {"Content-Type": "application/json"}
    # Forward the service-role key as a bearer to skip user auth — the
    # endpoints don't enforce auth on the server-only flow yet.
    try:
        with httpx.Client(timeout=httpx.Timeout(30.0), headers=headers) as c:
            for path in (f"/api/calls/{call_id}/summary", f"/api/calls/{call_id}/analyze"):
                try:
                    r = c.post(f"{base}{path}", json={})
                    if r.status_code >= 400:
                        logger.warning("post-call %s -> HTTP %d %s", path, r.status_code, r.text[:200])
                except Exception:
                    logger.exception("post-call %s failed", path)
    except Exception:
        logger.exception("trigger_post_call_pipeline failed")


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
