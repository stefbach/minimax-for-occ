"""Tests for the transfer_to_human LiveKit function_tool.

We exercise the builder + the inner POST helper directly. We mock
`httpx.AsyncClient.post` to avoid hitting the real Next.js endpoint and
to drive every branch (success, 500, missing env vars).
"""

from __future__ import annotations

import os
from unittest.mock import patch, AsyncMock, MagicMock

import httpx
import pytest

import tools_transfer


# ─── env helper ───────────────────────────────────────────────────────────

@pytest.fixture
def _env(monkeypatch):
    """Set the env vars the tool requires; tests can override per-case."""
    monkeypatch.setenv("INTERNAL_AGENT_API_TOKEN", "secret-test-token")
    monkeypatch.setenv("NEXT_PUBLIC_APP_URL", "https://app.example.com")
    # Clear VERCEL_URL so it doesn't sneak in as a fallback in CI.
    monkeypatch.delenv("VERCEL_URL", raising=False)
    # Prevent the disposition stamper from actually hitting Supabase.
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)


# ─── builder gating ───────────────────────────────────────────────────────

def test_builder_returns_none_when_token_missing(monkeypatch):
    """No INTERNAL_AGENT_API_TOKEN → tool must not register (we don't want
    older deployments to crash on first invocation)."""
    monkeypatch.delenv("INTERNAL_AGENT_API_TOKEN", raising=False)
    monkeypatch.setenv("NEXT_PUBLIC_APP_URL", "https://app.example.com")
    tool = tools_transfer.build_transfer_to_human_tool(
        org_id="org-1", contact_id="c-1", call_id="call-1", agent_handle_id="h-1",
    )
    assert tool is None


def test_builder_returns_none_when_app_url_missing(monkeypatch):
    """No NEXT_PUBLIC_APP_URL/VERCEL_URL → nothing to POST to → no tool."""
    monkeypatch.setenv("INTERNAL_AGENT_API_TOKEN", "tok")
    monkeypatch.delenv("NEXT_PUBLIC_APP_URL", raising=False)
    monkeypatch.delenv("VERCEL_URL", raising=False)
    tool = tools_transfer.build_transfer_to_human_tool(
        org_id="org-1", contact_id=None, call_id=None, agent_handle_id=None,
    )
    assert tool is None


def test_builder_returns_none_when_org_id_missing(_env):
    """Multi-tenant safety: never register a tool without an org_id."""
    tool = tools_transfer.build_transfer_to_human_tool(
        org_id=None, contact_id="c-1", call_id="call-1", agent_handle_id="h-1",
    )
    assert tool is None


def test_builder_returns_tool_when_env_ok(_env):
    """With token + base URL + org_id, the tool must register."""
    tool = tools_transfer.build_transfer_to_human_tool(
        org_id="org-1", contact_id="c-1", call_id="call-1", agent_handle_id="h-1",
    )
    assert tool is not None


# ─── happy path: sends the right payload to the right URL ────────────────

@pytest.mark.asyncio
async def test_post_transfer_success(_env):
    """A 200 from the endpoint → ok=True, returns task_id, logs success."""
    captured: dict = {}

    async def fake_post(self, url, headers=None, json=None, **kwargs):  # noqa: ARG001
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return httpx.Response(200, json={"task_id": "task-abc"})

    with patch.object(httpx.AsyncClient, "post", new=fake_post):
        ok, task_id, err = await tools_transfer._post_transfer(
            base_url="https://app.example.com",
            token="secret-test-token",
            payload={
                "org_id": "org-1",
                "contact_id": "c-1",
                "original_call_id": "call-1",
                "transferred_by_agent_id": "h-1",
                "qualification": "RDV demandé",
                "reason": "Le patient veut être rappelé demain matin.",
            },
        )

    assert ok is True
    assert task_id == "task-abc"
    assert err is None
    assert captured["url"] == "https://app.example.com/api/agent-tools/transfer-to-human"
    assert captured["headers"]["Authorization"] == "Bearer secret-test-token"
    assert captured["json"]["org_id"] == "org-1"
    assert captured["json"]["qualification"] == "RDV demandé"
    assert captured["json"]["original_call_id"] == "call-1"
    assert captured["json"]["transferred_by_agent_id"] == "h-1"


@pytest.mark.asyncio
async def test_tool_invocation_sends_expected_payload(_env):
    """End-to-end: build the tool, call its underlying coroutine, assert the
    payload we send matches the endpoint's contract."""
    captured: dict = {}

    async def fake_post(self, url, headers=None, json=None, **kwargs):  # noqa: ARG001
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return httpx.Response(200, json={"task_id": "task-xyz"})

    tool = tools_transfer.build_transfer_to_human_tool(
        org_id="org-multi", contact_id="cnt-1",
        call_id="call-9", agent_handle_id="hdl-2",
    )
    assert tool is not None

    # livekit-agents wraps the function — the original coroutine lives on the
    # tool object. Cover both attribute names across plugin versions.
    underlying = (
        getattr(tool, "fnc", None)
        or getattr(tool, "_fnc", None)
        or getattr(tool, "callable", None)
        or tool
    )

    with patch.object(httpx.AsyncClient, "post", new=fake_post):
        reply = await underlying(
            qualification="RDV demandé",
            reason="Patient veut prendre RDV mardi.",
        )

    assert "équipe" in reply or "noté" in reply.lower()
    assert captured["url"].endswith("/api/agent-tools/transfer-to-human")
    assert captured["headers"]["Authorization"] == "Bearer secret-test-token"
    body = captured["json"]
    assert body["org_id"] == "org-multi"
    assert body["contact_id"] == "cnt-1"
    assert body["original_call_id"] == "call-9"
    assert body["transferred_by_agent_id"] == "hdl-2"
    assert body["qualification"] == "RDV demandé"
    assert body["reason"].startswith("Patient veut")


# ─── error tolerance: 500 must not crash the call ────────────────────────

@pytest.mark.asyncio
async def test_post_transfer_tolerates_http_500(_env):
    """The endpoint returns 500 → we must return ok=False with an error msg,
    NOT raise (the call experience must not break)."""

    async def fake_post(self, url, headers=None, json=None, **kwargs):  # noqa: ARG001
        return httpx.Response(500, text="boom")

    with patch.object(httpx.AsyncClient, "post", new=fake_post):
        ok, task_id, err = await tools_transfer._post_transfer(
            base_url="https://app.example.com",
            token="tok",
            payload={"org_id": "org-1", "qualification": "Autre", "reason": "x"},
        )

    assert ok is False
    assert task_id is None
    assert err is not None
    assert "500" in err


@pytest.mark.asyncio
async def test_tool_returns_polite_confirmation_on_http_error(_env):
    """Tool-level: even on 500, the patient still hears a polite confirmation —
    we don't want to break the voice experience because of a server hiccup."""

    async def fake_post(self, url, headers=None, json=None, **kwargs):  # noqa: ARG001
        return httpx.Response(500, text="internal error")

    tool = tools_transfer.build_transfer_to_human_tool(
        org_id="org-1", contact_id="c-1", call_id=None, agent_handle_id=None,
    )
    assert tool is not None
    underlying = (
        getattr(tool, "fnc", None)
        or getattr(tool, "_fnc", None)
        or getattr(tool, "callable", None)
        or tool
    )

    with patch.object(httpx.AsyncClient, "post", new=fake_post):
        reply = await underlying(
            qualification="Question complexe",
            reason="The patient asked about NHS funding eligibility.",
        )

    # We must always return a non-empty French confirmation, never raise.
    assert isinstance(reply, str)
    assert len(reply) > 10


@pytest.mark.asyncio
async def test_post_transfer_tolerates_network_exception(_env):
    """httpx.ConnectError must not raise out of _post_transfer."""

    async def fake_post(self, url, headers=None, json=None, **kwargs):  # noqa: ARG001
        raise httpx.ConnectError("dns")

    with patch.object(httpx.AsyncClient, "post", new=fake_post):
        ok, task_id, err = await tools_transfer._post_transfer(
            base_url="https://app.example.com",
            token="tok",
            payload={"org_id": "org-1", "qualification": "Autre", "reason": "x"},
        )

    assert ok is False
    assert task_id is None
    assert err and "ConnectError" in err
