"""Supabase write helpers for the LiveKit worker.

Thin wrappers over the Supabase REST API. Each helper logs and
swallows errors — the call shouldn't die just because we failed to
record a telemetry event.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

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
    call_id: Optional[str] = None,
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
            qual = clean_patch.get("qualification")
            if qual:
                # Mirror the qualification onto calls.metadata so the
                # dashboard's qualification-bucket logic (which reads
                # calls.metadata.qualification) sees it. Previously the AI
                # was writing only to contacts.attributes.qualification and
                # the Vue d'ensemble counted every successful RDV as
                # "PAS DE REPONSE" because the call row stayed blank.
                if call_id:
                    update_call_metadata(call_id, {"qualification": str(qual)})
                # Auto-create a /desk follow-up task when the AI sets a
                # qualification that implies "human, please call this lead
                # back tomorrow". This is what makes Victoria's "we'll send
                # the slots" actually surface in the agent dashboard the
                # next morning without requiring transfer_to_human.
                if _qualification_needs_callback(qual):
                    create_human_callback_task(
                        org_id,
                        contact_id,
                        original_call_id=call_id,
                        qualification=str(qual),
                        reason="auto from save_contact_data",
                    )
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

            # The agent only knows the physical table name (not the registry
            # UUID). Resolve it once so table-scoped hooks match correctly.
            # None when this was a contact-mode save (no data table).
            resolved_table_id = data_table_id
            if resolved_table_id is None and physical_table:
                try:
                    rt = c.get(_supabase_url(
                        "/rest/v1/tenant_data_tables"
                        f"?select=id&org_id=eq.{org_id}"
                        f"&physical_table=eq.{physical_table}&limit=1"
                    ))
                    rt.raise_for_status()
                    rows = rt.json() or []
                    if rows:
                        resolved_table_id = rows[0].get("id")
                except Exception:
                    logger.exception("could not resolve data_table_id for %s", physical_table)

            # Fetch the full row once so downstream automations (n8n email /
            # WhatsApp on RDV CONFIRME) get everything they need — patient
            # email, name, phone, email_sent/whatsapp_sent flags — without
            # needing their own Supabase credentials for the read.
            full_row: dict[str, Any] | None = None
            if physical_table and row_id:
                try:
                    rr = c.get(_supabase_url(
                        f"/rest/v1/{physical_table}?id=eq.{row_id}&limit=1"
                    ))
                    rr.raise_for_status()
                    rows = rr.json() or []
                    if rows:
                        full_row = rows[0]
                except Exception:
                    logger.exception("could not fetch row for webhook payload (%s/%s)", physical_table, row_id)

            for h in hooks:
                col = h.get("watch_column") or "qualification"
                if col not in fields:
                    continue
                # Table scoping: a hook with NULL data_table_id fires for every
                # table; a hook bound to a specific table fires ONLY when this
                # save came from that table (so it never fires on contact-mode
                # saves or saves to other tables).
                hook_tbl = h.get("data_table_id")
                if hook_tbl and hook_tbl != resolved_table_id:
                    continue
                new_val = fields.get(col)
                matches = h.get("match_values") or []
                if matches and str(new_val) not in [str(m) for m in matches]:
                    continue
                payload = {
                    "event": h.get("event") or "qualification_changed",
                    "org_id": org_id,
                    "data_table": physical_table,
                    "data_table_id": resolved_table_id,
                    "row_id": row_id,
                    "watch_column": col,
                    "value": new_val,
                    "fields": fields,
                    "row": full_row,
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


def _iso_days_ago(n: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=int(n))).isoformat()


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
    """Best-effort: ask the web app to generate the summary, run analyses,
    AND propagate the call's signals back into the tenant's data_table
    (e.g. OCC's leads_rdv: call_count, last_call_datetime, date_jN,
    cycle_status, etc.).

    Uses NEXT_PUBLIC_APP_URL (or VERCEL_URL) so we hit the deployed API.
    If neither is set, we no-op — the front-end can also trigger this
    manually from the call detail page.
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
    token = os.getenv("APP_SHARED_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with httpx.Client(timeout=httpx.Timeout(30.0), headers=headers) as c:
            # sync-lead first so leads_rdv reflects the latest state before
            # the LLM summary uses it as context.
            for path in (
                f"/api/calls/{call_id}/sync-lead",
                f"/api/calls/{call_id}/summary",
                f"/api/calls/{call_id}/analyze",
            ):
                try:
                    r = c.post(f"{base}{path}", json={})
                    if r.status_code >= 400:
                        logger.warning("post-call %s -> HTTP %d %s", path, r.status_code, r.text[:200])
                except Exception:
                    logger.exception("post-call %s failed", path)
    except Exception:
        logger.exception("trigger_post_call_pipeline failed")


def record_agent_usage(
    org_id: Optional[str],
    call_id: Optional[str],
    *,
    llm_tokens: int = 0,
    tts_chars: int = 0,
    stt_seconds: float = 0.0,
    call_seconds: float = 0.0,
) -> None:
    """Report this call's REAL measured usage (LLM tokens, TTS chars, STT
    seconds, optionally call seconds for the Twilio-webhook fallback path)
    to the web app, which records it with cost so the dashboard shows real
    per-call cost. Best-effort: never blocks/raises into the call.

    `call_seconds` is the agent's measured wall-clock duration of the
    session. The web layer only writes a call_minutes usage_event for it
    when Twilio's StatusCallback didn't already produce one — so this is a
    safety net, not a double-billing path.
    """
    if not org_id:
        return
    if (
        (llm_tokens or 0) <= 0
        and (tts_chars or 0) <= 0
        and (stt_seconds or 0) <= 0
        and (call_seconds or 0) <= 0
    ):
        return
    base = (
        os.getenv("NEXT_PUBLIC_APP_URL")
        or (f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else None)
    )
    if not base:
        logger.debug("record_agent_usage: no APP_URL — skipping")
        return
    base = base.rstrip("/")
    headers = {"Content-Type": "application/json"}
    token = os.getenv("APP_SHARED_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with httpx.Client(timeout=httpx.Timeout(8.0), headers=headers) as c:
            r = c.post(
                f"{base}/api/usage/agent",
                json={
                    "org_id": org_id,
                    "call_id": call_id,
                    "llm_tokens": int(llm_tokens or 0),
                    "tts_chars": int(tts_chars or 0),
                    "stt_seconds": float(stt_seconds or 0.0),
                    "call_seconds": float(call_seconds or 0.0),
                },
            )
            if r.status_code >= 400:
                logger.warning("record_agent_usage -> HTTP %d %s", r.status_code, r.text[:200])
    except Exception:
        logger.exception("record_agent_usage failed (call=%s)", call_id)


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


def finalize_call_state(
    call_id: Optional[str],
    *,
    answered_at: Optional[str] = None,
    ended_at: Optional[str] = None,
    duration_secs: Optional[int] = None,
    state: str = "ended",
) -> None:
    """PATCH the calls row at session shutdown so the dashboard shows a
    finished call even when the Twilio status webhook never arrived
    (deployment URL not reachable from Twilio, signature mismatch, etc.).

    Never overrides terminal state already written by Twilio: if state is
    already 'completed' / 'failed' / etc. we leave the row alone.
    """
    if not call_id or not has_supabase():
        return
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.get(
                _supabase_url(
                    f"/rest/v1/calls?id=eq.{call_id}"
                    "&select=state,answered_at,ended_at,duration_secs"
                ),
            )
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return
            cur = rows[0]
            cur_state = (cur.get("state") or "").lower()
            terminal = {"completed", "ended", "failed", "busy", "no_answer",
                        "canceled", "cancelled"}
            if cur_state in terminal:
                # Twilio already finalised this one — don't touch.
                return
            body: dict[str, Any] = {"state": state}
            if ended_at and not cur.get("ended_at"):
                body["ended_at"] = ended_at
            if answered_at and not cur.get("answered_at"):
                body["answered_at"] = answered_at
            if duration_secs is not None and not cur.get("duration_secs"):
                body["duration_secs"] = int(duration_secs)
            r2 = c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=body,
            )
            r2.raise_for_status()
            logger.info(
                "finalize_call_state: %s -> state=%s duration=%ss",
                call_id, state, duration_secs,
            )
    except Exception:
        logger.exception("finalize_call_state failed (call=%s)", call_id)


# Qualification patterns — kept LOOSELY in sync with the canonical bucket
# regexes in web/lib/qualification.ts. Centralising in JSON is overkill
# since Python and TS regex syntax differ slightly; instead this list is
# DERIVED from the TS one and any drift surfaces in two ways:
#   (a) /api/calls/[id]/sync-lead writes the AI-set qualification verbatim
#       to leads_rdv.qualification — the dashboard then uses normalizeQualification
#       (TS) to bucket it for display, so display drift is self-healing.
#   (b) _qualification_needs_callback (this file) decides whether to spawn a
#       human_callback_tasks row. False negatives = a real RDV gets no /desk
#       task. So the list MUST include every soft positive Charlotte's prompt
#       can produce.
_CALLBACK_QUAL_PATTERNS = (
    # Hard positives
    "rdv", "rendez", "appointment", "confirm", "booked", "consultation_booked",
    # Soft positives (the AI's prompts actually emit these)
    "interested", "interess", "hot_lead", "hot lead", "warm_lead", "warm lead",
    "nouveau dossier", "new case", "nouveau_dossier",
    # Explicit callback / human transfer signals
    "rappel", "callback", "call_back", "call back", "follow_up", "follow up",
    "humain", "human", "to_human", "passer", "transferred_to_human",
)


def create_human_callback_task(
    org_id: Optional[str],
    contact_id: Optional[str],
    *,
    original_call_id: Optional[str] = None,
    qualification: Optional[str] = None,
    reason: Optional[str] = None,
    days_ahead: int = 1,
) -> None:
    """Insert a human_callback_tasks row scheduled J+`days_ahead` (rounded
    to the next weekday, 09:00 UTC) so the contact appears in `/desk` for
    a human follow-up.

    Dedupes: if the same contact already has a pending/in_progress task,
    no new row is created.
    """
    if not org_id or not has_supabase():
        return
    try:
        from datetime import datetime, timedelta, timezone
        scheduled = datetime.now(timezone.utc) + timedelta(days=days_ahead)
        # Snap to the next weekday — no Saturday/Sunday callbacks.
        while scheduled.weekday() >= 5:
            scheduled += timedelta(days=1)
        scheduled = scheduled.replace(hour=9, minute=0, second=0, microsecond=0)
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            if contact_id:
                check = c.get(_supabase_url(
                    f"/rest/v1/human_callback_tasks?contact_id=eq.{contact_id}"
                    f"&org_id=eq.{org_id}&status=in.(pending,in_progress)"
                    "&select=id&limit=1"
                ))
                if check.is_success and check.json():
                    logger.debug(
                        "create_human_callback_task: contact=%s already has open task",
                        contact_id,
                    )
                    return
            r = c.post(
                _supabase_url("/rest/v1/human_callback_tasks"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={
                    "org_id": org_id,
                    "contact_id": contact_id,
                    "original_call_id": original_call_id,
                    "qualification": qualification,
                    "transfer_reason": reason,
                    "scheduled_for": scheduled.isoformat(),
                    "status": "pending",
                },
            )
            r.raise_for_status()
            logger.info(
                "created human_callback_task contact=%s qual=%s scheduled=%s",
                contact_id, qualification, scheduled.isoformat(),
            )
    except Exception:
        logger.exception(
            "create_human_callback_task failed (contact=%s)", contact_id,
        )


def _qualification_needs_callback(raw: Optional[str]) -> bool:
    if not raw:
        return False
    s = str(raw).lower()
    # Exclude negative qualifications so we don't book follow-ups for
    # patients who explicitly said no.
    negative = ("pas_interess", "pas interess", "not interest", "decline",
                "do_not_call", "do not call", "dnc", "ne pas rappel",
                "wrong number", "faux num", "non eligib", "non éligib",
                "ineligib", "not eligib")
    if any(n in s for n in negative):
        return False
    return any(p in s for p in _CALLBACK_QUAL_PATTERNS)


def auto_qualify_call(call_id: Optional[str]) -> None:
    """Heuristic post-call qualification for calls where the AI agent never
    wrote one explicitly via save_contact_data. Without this, every short
    voicemail / dropped audio / patient hangup leaves
    calls.metadata.qualification = NULL and the dashboard buckets it as
    'Autre' instead of REPONDEUR / PAS DE REPONSE / etc.

    Decision tree — biased toward "let the campaign retry" so we don't
    permanently exclude patients who were just busy or in a meeting:

      handoff_count > 0                    → A PASSER A L'HUMAIN
      not answered                         → PAS DE REPONSE
      duration ≤ 5s                        → REPONDEUR  (likely AMD voicemail)
      duration ≤ 15s                       → PAS DE REPONSE  (carrier drop)
      duration < 30s + attempts ≥ N_GIVEUP → PAS INTERESSE
      duration < 30s + attempts < N_GIVEUP → RAPPEL  (retry later — they
                                              were maybe just busy)
      duration ≥ 30s                       → RAPPEL  (real conversation,
                                              operator follow-up)

    `N_GIVEUP` defaults to 10 and is env-overridable via
    PAS_INTERESSE_AFTER_N_ATTEMPTS. The point is: a short call alone is
    not a hard 'no' — the patient might pick up next time. Only after
    repeated short hangups do we mark them PAS INTERESSE and exclude
    them from the campaign's reselection (which uses the negative-list
    filter in dialer/src/dynamic-selection.ts).

    Never overrides an explicit qualification already in
    calls.metadata.qualification (so save_contact_data winners win).
    """
    if not call_id or not has_supabase():
        return
    n_giveup = int(os.getenv("PAS_INTERESSE_AFTER_N_ATTEMPTS", "10"))
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.get(
                _supabase_url(
                    f"/rest/v1/calls?id=eq.{call_id}"
                    "&select=metadata,duration_secs,answered_at,to_e164,org_id"
                ),
            )
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return
            row = rows[0]
            current_meta = row.get("metadata") or {}
            if isinstance(current_meta, dict) and current_meta.get("qualification"):
                logger.debug(
                    "auto_qualify_call: %s already has qualification=%s, skipping",
                    call_id, current_meta.get("qualification"),
                )
                return

            duration = float(row.get("duration_secs") or 0)
            answered = bool(row.get("answered_at"))
            to_e164 = row.get("to_e164")
            org_id = row.get("org_id")

            # Handoff events: objective signal that the patient engaged
            # enough to be transferred to a specialist.
            handoff_count = 0
            try:
                he = c.get(
                    _supabase_url(
                        f"/rest/v1/call_events?call_id=eq.{call_id}"
                        "&kind=in.(handoff_initiated,handoff_to_handle)"
                        "&select=id"
                    ),
                )
                if he.is_success:
                    handoff_count = len(he.json() or [])
            except Exception:
                pass

            # Attempts so far on this number: counts every previous Axon-
            # placed call to the same E.164 for the same org over the
            # last 90 days. Used only when we'd otherwise mark the lead
            # PAS INTERESSE — we want repeated rejections before giving
            # up on a phone number.
            attempts = 0
            if to_e164 and org_id:
                try:
                    cr = c.get(
                        _supabase_url(
                            f"/rest/v1/calls?to_e164=eq.{to_e164}"
                            f"&org_id=eq.{org_id}"
                            "&select=id"
                            "&started_at=gt." + _iso_days_ago(90)
                        ),
                    )
                    if cr.is_success:
                        attempts = len(cr.json() or [])
                except Exception:
                    pass

            # ── Audio-drop heuristic (Scenario 1 — Mauvais réseau) ──────────
            # Pattern: a real conversation that was interrupted by network
            # quality, not finished naturally. We detect it without WebRTC
            # metrics by combining three boundary-style signals:
            #   • duration is between 5s and 30s (long enough for STT to
            #     register a turn, short enough to be abnormal vs a real
            #     conversation),
            #   • the patient actually spoke at least once (a row in
            #     public.call_transcripts with speaker='user'), proving the
            #     mic was working — rules out PBX auto-200OK silence and AMD
            #     voicemails,
            #   • the hygiene watchdog did NOT fire its goodbye-shaped
            #     hangup (call_events.kind='auto_hangup' with 'goodbye' in
            #     payload.reason). A natural close would have triggered it.
            #
            # When matched, we stamp disposition='audio_dropped',
            # qualification='RAPPEL' (real engagement happened, just got
            # cut), and reschedule the campaign_target for +1h. We also set
            # metadata.no_attempt=true so sync-lead doesn't bump
            # j1_attempts / stamp date_j1 — the lead stays in the same
            # phase as if the attempt never happened.
            audio_dropped = False
            if answered and 5 < duration < 30:
                had_goodbye_hangup = False
                try:
                    ah = c.get(
                        _supabase_url(
                            f"/rest/v1/call_events?call_id=eq.{call_id}"
                            "&kind=eq.auto_hangup&select=payload"
                        ),
                    )
                    if ah.is_success:
                        for ev in ah.json() or []:
                            payload = ev.get("payload") or {}
                            reason = (
                                (payload.get("reason") or "").lower()
                                if isinstance(payload, dict) else ""
                            )
                            if "goodbye" in reason:
                                had_goodbye_hangup = True
                                break
                except Exception:
                    pass
                had_user_turn = False
                try:
                    ut = c.get(
                        _supabase_url(
                            f"/rest/v1/call_transcripts?call_id=eq.{call_id}"
                            "&speaker=eq.user&select=seq&limit=1"
                        ),
                    )
                    if ut.is_success:
                        had_user_turn = bool(ut.json() or [])
                except Exception:
                    pass
                audio_dropped = (not had_goodbye_hangup) and had_user_turn

            if audio_dropped:
                qual = "RAPPEL"
                qualification_source = "audio_drop_heuristic"
            elif handoff_count > 0:
                qual = "A PASSER A L'HUMAIN"
                qualification_source = "auto_inferred"
            elif not answered or duration == 0:
                qual = "PAS DE REPONSE"
                qualification_source = "auto_inferred"
            elif duration <= 5:
                qual = "REPONDEUR"
                qualification_source = "auto_inferred"
            elif duration <= 15:
                qual = "PAS DE REPONSE"
                qualification_source = "auto_inferred"
            elif duration < 30:
                # Short engagement: don't lock the patient out unless
                # they've already been bothered N_GIVEUP times.
                qual = "PAS INTERESSE" if attempts >= n_giveup else "RAPPEL"
                qualification_source = "auto_inferred"
            else:
                qual = "RAPPEL"
                qualification_source = "auto_inferred"

            merged = {
                **(current_meta if isinstance(current_meta, dict) else {}),
                "qualification": qual,
                "qualification_source": qualification_source,
            }
            # Audio-drop bypass: tell sync-lead this attempt doesn't count
            # toward the phase cadence. Also stamp the call disposition so
            # the dashboard can bucket these as a distinct failure mode.
            if audio_dropped:
                merged["no_attempt"] = True
            # Re-check just before write to avoid a race where
            # save_contact_data committed an explicit qualification
            # between our initial read and this PATCH. Without this guard,
            # auto-inferred "PAS DE REPONSE" could overwrite an agent-set
            # "consultation_booked" simply because the AI's HTTP write
            # arrived a few ms later than ours.
            r_chk = c.get(_supabase_url(
                f"/rest/v1/calls?id=eq.{call_id}&select=metadata"
            ))
            if r_chk.is_success:
                chk = (r_chk.json() or [{}])[0].get("metadata") or {}
                if isinstance(chk, dict) and chk.get("qualification") and chk.get("qualification_source") != "auto_inferred":
                    logger.info(
                        "auto_qualify_call: %s skipped — explicit qualification %s appeared during inference",
                        call_id, chk.get("qualification"),
                    )
                    return
            # If audio-dropped, write the metadata AND the disposition in
            # one PATCH so the dashboard's disposition bucket and the
            # metadata.qualification can't drift.
            calls_patch: Dict[str, object] = {"metadata": merged}
            if audio_dropped:
                calls_patch["disposition"] = "audio_dropped"
            r2 = c.patch(
                _supabase_url(f"/rest/v1/calls?id=eq.{call_id}"),
                headers={
                    **_supabase_headers(),
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=calls_patch,
            )
            r2.raise_for_status()
            logger.info(
                "auto_qualify_call: %s -> %s (duration=%.0fs answered=%s handoffs=%d attempts=%d/%d source=%s)",
                call_id, qual, duration, answered, handoff_count, attempts, n_giveup, qualification_source,
            )

            # Audio-drop retry: bring the lead back into the pending queue
            # 1 hour from now instead of waiting for the next cadence slot
            # (08/13/18 UK). The dialer's 30s poll loop picks pending rows
            # with next_attempt_at <= now() so no other plumbing is needed.
            if audio_dropped:
                target_id = (
                    current_meta.get("target_id")
                    if isinstance(current_meta, dict) else None
                )
                if isinstance(target_id, str) and target_id:
                    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
                    next_at = (_dt.now(_tz.utc) + _td(hours=1)).isoformat()
                    try:
                        c.patch(
                            _supabase_url(
                                f"/rest/v1/campaign_targets?id=eq.{target_id}"
                            ),
                            headers={
                                **_supabase_headers(),
                                "Content-Type": "application/json",
                                "Prefer": "return=minimal",
                            },
                            json={
                                "status": "pending",
                                "next_attempt_at": next_at,
                            },
                        )
                        logger.info(
                            "audio_drop_retry: target=%s next_attempt_at=%s",
                            target_id, next_at,
                        )
                    except Exception:
                        logger.exception(
                            "audio_drop_retry schedule failed (target=%s)",
                            target_id,
                        )
    except Exception:
        logger.exception("auto_qualify_call failed (call=%s)", call_id)

