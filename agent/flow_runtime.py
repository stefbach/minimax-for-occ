"""IVR flow runtime — drives `public.flows` state machines on a LiveKit call.

The webhook (Twilio inbound or `/api/token`) puts `flow_id` into the
room metadata. The entrypoint detects that and hands the session over
to a :class:`FlowRuntime` instead of running the single-agent loop.

Each `flow_steps.kind` maps to a `_step_*` handler. The handler returns
either a `condition_input` dict (e.g. `{"dtmf": "1"}`) used to pick the
next edge, or `None` to follow an `{"kind":"always"}` edge.

Real STT/DTMF wiring is left as TODOs where the LiveKit Agents 1.5 API
doesn't yet expose a clean callback — the runtime degrades gracefully:
on missing input it picks the first matching edge so flows still
terminate.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from agent_config import (
    _supabase_headers,
    _supabase_url,
    has_supabase,
    load_agent,
)
from db_writes import (
    append_call_event,
    update_call_metadata,
    update_call_recording_url,
)

logger = logging.getLogger("axon.flow")

# Safety net: never let a misconfigured flow loop forever.
MAX_STEPS_PER_CALL = 64


# ─── Data model ──────────────────────────────────────────────────────────


@dataclass
class FlowStep:
    id: str
    kind: str
    label: Optional[str]
    config: dict[str, Any]


@dataclass
class FlowEdge:
    id: str
    from_step_id: str
    to_step_id: str
    condition: dict[str, Any]
    position: int = 0


@dataclass
class Flow:
    id: str
    org_id: str
    name: str
    start_step_id: Optional[str]
    steps: dict[str, FlowStep] = field(default_factory=dict)
    edges_by_from: dict[str, list[FlowEdge]] = field(default_factory=dict)

    def start_step(self) -> Optional[FlowStep]:
        if not self.start_step_id:
            return None
        return self.steps.get(self.start_step_id)

    def outgoing(self, step_id: str) -> list[FlowEdge]:
        return sorted(
            self.edges_by_from.get(step_id, []),
            key=lambda e: e.position,
        )

    def next_step(
        self,
        from_step: FlowStep,
        condition_input: Optional[dict[str, Any]],
    ) -> Optional[FlowStep]:
        """Pick the next step given the result of the current step.

        condition_input may contain ``dtmf`` (str) or ``intent`` (str).
        Priority: exact match > fallback > always > first.
        """
        edges = self.outgoing(from_step.id)
        if not edges:
            return None

        fallback: Optional[FlowEdge] = None
        always: Optional[FlowEdge] = None

        for e in edges:
            kind = (e.condition or {}).get("kind", "always")
            if kind == "always" and always is None:
                always = e
            elif kind == "fallback" and fallback is None:
                fallback = e
            elif kind == "dtmf" and condition_input and condition_input.get("dtmf"):
                if str(e.condition.get("key")) == str(condition_input["dtmf"]):
                    return self.steps.get(e.to_step_id)
            elif kind == "intent" and condition_input and condition_input.get("intent"):
                if str(e.condition.get("value")) == str(condition_input["intent"]):
                    return self.steps.get(e.to_step_id)

        if always is not None:
            return self.steps.get(always.to_step_id)
        if fallback is not None:
            return self.steps.get(fallback.to_step_id)
        # No always/fallback and no matching condition — take first edge.
        return self.steps.get(edges[0].to_step_id)


# ─── Runtime ─────────────────────────────────────────────────────────────


class FlowRuntime:
    """Loads a flow from Supabase and walks it on top of an AgentSession."""

    def __init__(self, *, call_id: Optional[str] = None) -> None:
        self.call_id = call_id
        self.flow: Optional[Flow] = None

    # ── Loading ────────────────────────────────────────────────────────

    async def load(self, flow_id: str) -> Flow:
        if not has_supabase():
            raise RuntimeError("Supabase env not configured — cannot load flow")
        loop = asyncio.get_event_loop()
        flow = await loop.run_in_executor(None, self._load_sync, flow_id)
        self.flow = flow
        return flow

    @staticmethod
    def _load_sync(flow_id: str) -> Flow:
        with httpx.Client(timeout=httpx.Timeout(10.0), headers=_supabase_headers()) as c:
            r = c.get(_supabase_url(f"/rest/v1/flows?id=eq.{flow_id}&select=*"))
            r.raise_for_status()
            rows = r.json()
            if not rows:
                raise RuntimeError(f"flow {flow_id} not found")
            f = rows[0]

            r2 = c.get(
                _supabase_url(f"/rest/v1/flow_steps?flow_id=eq.{flow_id}&select=*")
            )
            r2.raise_for_status()
            step_rows = r2.json() or []

            r3 = c.get(
                _supabase_url(
                    f"/rest/v1/flow_edges?flow_id=eq.{flow_id}&select=*&order=position.asc"
                )
            )
            r3.raise_for_status()
            edge_rows = r3.json() or []

        steps = {
            s["id"]: FlowStep(
                id=s["id"],
                kind=s["kind"],
                label=s.get("label"),
                config=s.get("config") or {},
            )
            for s in step_rows
        }
        edges_by_from: dict[str, list[FlowEdge]] = {}
        for e in edge_rows:
            fe = FlowEdge(
                id=e["id"],
                from_step_id=e["from_step_id"],
                to_step_id=e["to_step_id"],
                condition=e.get("condition") or {"kind": "always"},
                position=int(e.get("position") or 0),
            )
            edges_by_from.setdefault(fe.from_step_id, []).append(fe)

        return Flow(
            id=f["id"],
            org_id=f["org_id"],
            name=f.get("name") or "flow",
            start_step_id=f.get("start_step_id"),
            steps=steps,
            edges_by_from=edges_by_from,
        )

    # ── Execution ──────────────────────────────────────────────────────

    async def execute(self, session, ctx) -> None:
        if not self.flow:
            raise RuntimeError("flow not loaded; call .load() first")

        step = self.flow.start_step()
        if step is None:
            logger.warning("flow %s has no start step — nothing to do", self.flow.id)
            return

        append_call_event(
            self.call_id,
            "flow_started",
            {"flow_id": self.flow.id, "flow_name": self.flow.name},
        )

        visited = 0
        while step is not None:
            visited += 1
            if visited > MAX_STEPS_PER_CALL:
                logger.error(
                    "flow %s exceeded max steps (%d) — aborting",
                    self.flow.id,
                    MAX_STEPS_PER_CALL,
                )
                append_call_event(
                    self.call_id,
                    "flow_aborted",
                    {"reason": "max_steps_exceeded"},
                )
                break

            logger.info("flow step: kind=%s id=%s label=%s", step.kind, step.id, step.label)
            append_call_event(
                self.call_id,
                "flow_step_entered",
                {"step_id": step.id, "kind": step.kind, "label": step.label},
            )

            handler = getattr(self, f"_step_{step.kind}", None)
            if handler is None:
                logger.warning("no handler for step kind %r — skipping", step.kind)
                cond_input: Optional[dict[str, Any]] = None
            else:
                try:
                    cond_input = await handler(session, ctx, step)
                except Exception:
                    logger.exception("step %s (%s) failed", step.id, step.kind)
                    append_call_event(
                        self.call_id,
                        "flow_step_error",
                        {"step_id": step.id, "kind": step.kind},
                    )
                    cond_input = None

            # Terminal kinds end the loop.
            if step.kind in {"hangup", "route_queue", "voicemail"}:
                break

            next_step = self.flow.next_step(step, cond_input)
            if next_step is None:
                logger.info("flow %s: no outgoing edge from %s — done", self.flow.id, step.id)
                break
            step = next_step

        append_call_event(self.call_id, "flow_ended", {"flow_id": self.flow.id})

    # ── Step handlers ──────────────────────────────────────────────────

    async def _step_welcome(self, session, ctx, step: FlowStep):
        text = (step.config or {}).get("text") or ""
        if text:
            await session.say(text, allow_interruptions=True)
        return None

    async def _step_menu_dtmf(self, session, ctx, step: FlowStep):
        cfg = step.config or {}
        prompt = cfg.get("prompt") or "Please select an option."
        await session.say(prompt, allow_interruptions=True)

        key = await _await_dtmf(ctx, timeout=10.0)
        if key is None:
            logger.warning(
                "menu_dtmf step %s: no DTMF received — falling back to first edge",
                step.id,
            )
            return None
        logger.info("menu_dtmf step %s: received DTMF %s", step.id, key)
        append_call_event(self.call_id, "dtmf_received", {"key": key, "step_id": step.id})
        return {"dtmf": key}

    async def _step_gather_speech(self, session, ctx, step: FlowStep):
        cfg = step.config or {}
        prompt = cfg.get("prompt") or "How can I help you?"
        intents = cfg.get("intents") or []

        await session.say(prompt, allow_interruptions=True)

        transcript = await _await_transcript(session, timeout=15.0)
        if not transcript:
            logger.warning("gather_speech step %s: no transcript captured", step.id)
            return None

        append_call_event(
            self.call_id,
            "speech_captured",
            {"transcript": transcript, "step_id": step.id},
        )

        intent = _classify_intent(transcript, intents)
        if intent:
            logger.info("gather_speech step %s: intent=%s", step.id, intent)
            append_call_event(
                self.call_id,
                "intent_classified",
                {"intent": intent, "step_id": step.id},
            )
            return {"intent": intent}
        return None

    async def _step_ai_agent(self, session, ctx, step: FlowStep):
        cfg = step.config or {}
        agent_handle_id = cfg.get("agent_handle_id")
        if not agent_handle_id:
            logger.warning("ai_agent step %s missing agent_handle_id", step.id)
            return None

        ai_agent_id = _resolve_handle_to_ai_agent(agent_handle_id)
        if not ai_agent_id:
            logger.warning("ai_agent step %s: handle %s did not resolve", step.id, agent_handle_id)
            return None

        axon = load_agent(ai_agent_id)
        if not axon:
            logger.warning("ai_agent step %s: agent %s failed to load", step.id, ai_agent_id)
            return None

        # Hot-swap LLM + TTS on the live session.
        try:
            from agent import _llm_for, _tts_for  # local import to avoid cycle at import time

            session.llm = _llm_for(axon)
            session.tts = _tts_for(axon)
            logger.info(
                "ai_agent step %s: swapped persona -> %s (%s)",
                step.id,
                axon.id,
                axon.name,
            )
            append_call_event(
                self.call_id,
                "persona_swapped",
                {"agent_id": axon.id, "agent_name": axon.name, "step_id": step.id},
            )
        except Exception:
            logger.exception("failed to hot-swap persona at step %s", step.id)
            return None

        # If this is a terminal AI-agent step (no outgoing edges), hand the
        # rest of the call to the LLM by greeting and letting the session
        # idle — AgentSession keeps running until the room closes.
        if not self.flow.outgoing(step.id):
            if axon.greeting:
                await session.say(axon.greeting, allow_interruptions=True)
            # Block here so the loop doesn't exit while the AI talks.
            await _wait_for_disconnect(ctx)
        return None

    async def _step_transfer(self, session, ctx, step: FlowStep):
        cfg = step.config or {}
        to_e164 = cfg.get("to_e164")
        if not to_e164:
            logger.warning("transfer step %s missing to_e164", step.id)
            return None
        append_call_event(
            self.call_id,
            "transfer_requested",
            {"to_e164": to_e164, "step_id": step.id},
        )
        update_call_metadata(self.call_id, {"transfer_to_e164": to_e164})
        # TODO: emit SIP REFER via LiveKit SIP API once available.
        return None

    async def _step_route_queue(self, session, ctx, step: FlowStep):
        cfg = step.config or {}
        queue_id = cfg.get("queue_id")
        append_call_event(
            self.call_id,
            "queued",
            {"queue_id": queue_id, "step_id": step.id},
        )
        update_call_metadata(self.call_id, {"queued_queue_id": queue_id})
        # AI session ends so a human softphone can pick up the room.
        return None

    async def _step_voicemail(self, session, ctx, step: FlowStep):
        cfg = step.config or {}
        prompt = cfg.get("prompt") or "Please leave a message after the tone."
        max_secs = int(cfg.get("max_duration_secs") or 60)

        await session.say(prompt, allow_interruptions=False)

        # TODO: trigger a LiveKit RoomCompositeEgress here for real audio
        # capture. For now we stub a recording_url placeholder so the
        # call timeline reflects the voicemail attempt.
        recording_url = f"livekit-egress://pending/{ctx.room.name}"
        append_call_event(
            self.call_id,
            "voicemail_started",
            {"max_duration_secs": max_secs, "step_id": step.id},
        )
        update_call_recording_url(self.call_id, recording_url)
        try:
            await asyncio.sleep(min(max_secs, 5))  # short stub wait
        except asyncio.CancelledError:
            pass
        append_call_event(
            self.call_id,
            "voicemail_ended",
            {"recording_url": recording_url, "step_id": step.id},
        )
        return None

    async def _step_hangup(self, session, ctx, step: FlowStep):
        append_call_event(self.call_id, "hangup", {"step_id": step.id})
        try:
            await ctx.room.disconnect()
        except Exception:
            logger.exception("ctx.room.disconnect() failed")
        return None


# ─── Helpers (DTMF / STT / intent) ───────────────────────────────────────


async def _await_dtmf(ctx, timeout: float = 10.0) -> Optional[str]:
    """Best-effort DTMF capture.

    LiveKit's SIP DTMF events arrive as ``SipDTMF`` on the room. The
    API surface has shifted between agent versions, so we try the most
    common channels and fall back to data messages.
    """
    fut: asyncio.Future[str] = asyncio.get_event_loop().create_future()

    def _resolve(key: str) -> None:
        if not fut.done():
            fut.set_result(key)

    def _on_dtmf(event) -> None:  # pragma: no cover - depends on runtime API
        digit = getattr(event, "digit", None) or getattr(event, "code", None)
        if digit is not None:
            _resolve(str(digit))

    def _on_data(packet) -> None:  # pragma: no cover
        try:
            data = getattr(packet, "data", packet)
            if isinstance(data, (bytes, bytearray)):
                payload = json.loads(data.decode("utf-8", errors="ignore"))
            elif isinstance(data, str):
                payload = json.loads(data)
            else:
                return
            if isinstance(payload, dict) and "dtmf" in payload:
                _resolve(str(payload["dtmf"]))
        except Exception:
            return

    try:
        try:
            ctx.room.on("sip_dtmf_received", _on_dtmf)
        except Exception:
            pass
        try:
            ctx.room.on("data_received", _on_data)
        except Exception:
            pass

        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            return None
    finally:
        for name, cb in (("sip_dtmf_received", _on_dtmf), ("data_received", _on_data)):
            try:
                ctx.room.off(name, cb)
            except Exception:
                pass


async def _await_transcript(session, timeout: float = 15.0) -> Optional[str]:
    """Wait for one user transcript from the AgentSession.

    Falls back to None on timeout. LiveKit Agents 1.5 exposes
    `user_input_transcribed` as a session event; we listen for one.
    """
    fut: asyncio.Future[str] = asyncio.get_event_loop().create_future()

    def _on_transcript(event) -> None:  # pragma: no cover
        text = (
            getattr(event, "transcript", None)
            or getattr(event, "text", None)
            or getattr(event, "alternatives", [None])[0]
        )
        if isinstance(text, str) and text.strip() and not fut.done():
            fut.set_result(text.strip())

    bound = False
    for name in ("user_input_transcribed", "user_speech_committed", "transcript"):
        try:
            session.on(name, _on_transcript)
            bound = True
            break
        except Exception:
            continue
    if not bound:
        logger.debug("no transcript event hook available on session")
        return None

    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        return None
    finally:
        for name in ("user_input_transcribed", "user_speech_committed", "transcript"):
            try:
                session.off(name, _on_transcript)
            except Exception:
                continue


def _classify_intent(transcript: str, intents: list[dict[str, Any]]) -> Optional[str]:
    """Ask OpenAI to pick one of the configured intent labels.

    On failure or low confidence returns None — the runtime then takes
    the fallback / first edge.
    """
    if not transcript or not intents:
        return None
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        # Cheap fallback: substring match on hints/labels.
        low = transcript.lower()
        for it in intents:
            for needle in (it.get("hint"), it.get("label")):
                if needle and str(needle).lower() in low:
                    return str(it.get("label"))
        return None

    labels = [str(i.get("label")) for i in intents if i.get("label")]
    hints_blob = "\n".join(
        f"- {i.get('label')}: {i.get('hint') or ''}" for i in intents
    )
    try:
        with httpx.Client(timeout=httpx.Timeout(8.0)) as c:
            r = c.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": os.getenv("FLOW_INTENT_MODEL", "gpt-4o-mini"),
                    "temperature": 0,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "Classify the user utterance into exactly one of "
                                "these intent labels. Reply with only the label, "
                                "no punctuation. If none fit, reply NONE.\n"
                                f"Intents:\n{hints_blob}"
                            ),
                        },
                        {"role": "user", "content": transcript},
                    ],
                },
            )
            r.raise_for_status()
            out = (
                r.json()["choices"][0]["message"]["content"].strip().splitlines()[0]
            )
            if out.upper() == "NONE":
                return None
            for lbl in labels:
                if out.lower() == lbl.lower():
                    return lbl
            return None
    except Exception:
        logger.exception("intent classification failed")
        return None


def _resolve_handle_to_ai_agent(agent_handle_id: str) -> Optional[str]:
    if not has_supabase():
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0), headers=_supabase_headers()) as c:
            r = c.get(
                _supabase_url(
                    f"/rest/v1/agent_handles?id=eq.{agent_handle_id}&select=ai_agent_id,kind"
                )
            )
            r.raise_for_status()
            rows = r.json() or []
            if not rows:
                return None
            return rows[0].get("ai_agent_id")
    except Exception:
        logger.exception("resolve handle %s failed", agent_handle_id)
        return None


async def _wait_for_disconnect(ctx) -> None:
    """Block until the room is disconnected (or cancelled)."""
    fut: asyncio.Future[None] = asyncio.get_event_loop().create_future()

    def _done(*_a, **_kw) -> None:
        if not fut.done():
            fut.set_result(None)

    bound = False
    for name in ("disconnected", "room_disconnected"):
        try:
            ctx.room.on(name, _done)
            bound = True
        except Exception:
            continue

    if not bound:
        # Last resort: never returns until task cancelled.
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return
        return

    try:
        await fut
    except asyncio.CancelledError:
        return


# ─── Metadata helpers ────────────────────────────────────────────────────


def flow_id_from_metadata(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    fid = data.get("flow_id") if isinstance(data, dict) else None
    return str(fid) if fid else None


def call_id_from_metadata(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    cid = data.get("call_id") if isinstance(data, dict) else None
    return str(cid) if cid else None


def handoff_target_from_metadata(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    tgt = data.get("handoff_to") if isinstance(data, dict) else None
    return str(tgt) if tgt else None
