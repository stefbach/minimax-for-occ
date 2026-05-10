"""n8n integration for the LiveKit voice agent.

Exposes function tools the LLM can call during a voice conversation:

  * list_n8n_workflows()             — discover active workflows
  * trigger_n8n_workflow(path, body) — fire a webhook trigger
  * get_n8n_execution(execution_id)  — poll an execution result

Webhook trigger is the recommended pattern: each n8n workflow starts with a
Webhook node, and the agent POSTs JSON to it. The Public API (JWT) is used
only for discovery / status — never for credentials.

Env:
    N8N_BASE_URL          e.g. https://n8n.example.cloud
    N8N_API_KEY           Public API JWT (Settings -> API in n8n UI)
    N8N_WEBHOOK_BASE_URL  optional, defaults to ${N8N_BASE_URL}/webhook
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx
from livekit.agents import function_tool

logger = logging.getLogger("n8n-tools")


class N8nClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        webhook_base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = (base_url or os.environ["N8N_BASE_URL"]).rstrip("/")
        self.api_key = api_key or os.environ["N8N_API_KEY"]
        self.webhook_base_url = (
            webhook_base_url
            or os.getenv("N8N_WEBHOOK_BASE_URL")
            or f"{self.base_url}/webhook"
        ).rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={"X-N8N-API-KEY": self.api_key, "Accept": "application/json"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def list_workflows(self, *, active: bool = True) -> list[dict[str, Any]]:
        r = await self._client.get(
            f"{self.base_url}/api/v1/workflows",
            params={"active": "true" if active else "false"},
        )
        r.raise_for_status()
        return r.json().get("data", [])

    async def trigger_webhook(
        self, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        path = path.lstrip("/")
        url = f"{self.webhook_base_url}/{path}"
        r = await httpx.AsyncClient(timeout=httpx.Timeout(60.0)).post(
            url, json=payload or {}
        )
        r.raise_for_status()
        try:
            return {"status": r.status_code, "data": r.json()}
        except json.JSONDecodeError:
            return {"status": r.status_code, "text": r.text}

    async def get_execution(self, execution_id: str) -> dict[str, Any]:
        r = await self._client.get(
            f"{self.base_url}/api/v1/executions/{execution_id}",
            params={"includeData": "true"},
        )
        r.raise_for_status()
        return r.json()


def build_n8n_tools(client: N8nClient | None = None) -> list:
    """Return LiveKit function_tools bound to a shared n8n client."""

    if client is None:
        client = N8nClient()

    @function_tool
    async def list_n8n_workflows() -> str:
        """List active n8n workflows available to trigger.

        Returns a JSON array of {id, name, tags, webhook_paths} entries.
        """
        try:
            workflows = await client.list_workflows()
        except Exception as exc:
            logger.exception("n8n list failed")
            return json.dumps({"error": str(exc)})

        summary = []
        for wf in workflows:
            paths: list[str] = []
            for node in wf.get("nodes", []):
                if "webhook" in str(node.get("type", "")).lower():
                    p = node.get("parameters", {}).get("path")
                    if p:
                        paths.append(p)
            summary.append(
                {
                    "id": wf.get("id"),
                    "name": wf.get("name"),
                    "tags": [t.get("name") for t in wf.get("tags", []) if isinstance(t, dict)],
                    "webhook_paths": paths,
                }
            )
        return json.dumps(summary, ensure_ascii=False)

    @function_tool
    async def trigger_n8n_workflow(webhook_path: str, payload_json: str = "{}") -> str:
        """Trigger an n8n workflow by POSTing to its webhook path.

        Args:
            webhook_path: the webhook path configured on the workflow's
                Webhook node (e.g. "book-appointment").
            payload_json: JSON-encoded object passed as the request body.
        """
        try:
            payload = json.loads(payload_json) if payload_json else {}
        except json.JSONDecodeError as exc:
            return json.dumps({"error": f"invalid JSON payload: {exc}"})
        try:
            return json.dumps(await client.trigger_webhook(webhook_path, payload), ensure_ascii=False)
        except httpx.HTTPStatusError as exc:
            return json.dumps(
                {"error": "http_error", "status": exc.response.status_code, "body": exc.response.text}
            )
        except Exception as exc:
            logger.exception("n8n trigger failed")
            return json.dumps({"error": str(exc)})

    @function_tool
    async def get_n8n_execution(execution_id: str) -> str:
        """Fetch the result of a previously triggered n8n execution by id."""
        try:
            return json.dumps(await client.get_execution(execution_id), ensure_ascii=False)
        except Exception as exc:
            logger.exception("n8n execution fetch failed")
            return json.dumps({"error": str(exc)})

    return [list_n8n_workflows, trigger_n8n_workflow, get_n8n_execution]


def build_scoped_n8n_tools(client: N8nClient, allowed: list[dict]) -> list:
    """Tools restricted to a whitelist of workflows (one tool per workflow).

    Each entry of `allowed` is an `agent_n8n_workflows` row, with at minimum
    `workflow_name`, `webhook_path` and optionally `description`.
    """
    from livekit.agents import function_tool

    tools = []
    seen = set()
    for w in allowed:
        path = (w.get("webhook_path") or "").strip().lstrip("/")
        name = (w.get("workflow_name") or path).strip()
        if not path or path in seen:
            continue
        seen.add(path)
        description = (w.get("description") or f"Trigger the n8n workflow '{name}' (POST {path}).").strip()

        # Build a dedicated tool function per workflow with a clean name and docstring.
        # Function name must be a valid Python identifier — derive from path.
        ident = "n8n_" + "".join(ch if ch.isalnum() else "_" for ch in path).strip("_")
        path_value = path  # bind for closure

        async def _impl(payload_json: str = "{}", _path: str = path_value) -> str:
            try:
                payload = json.loads(payload_json) if payload_json else {}
            except json.JSONDecodeError as exc:
                return json.dumps({"error": f"invalid JSON payload: {exc}"})
            try:
                return json.dumps(
                    await client.trigger_webhook(_path, payload), ensure_ascii=False
                )
            except httpx.HTTPStatusError as exc:
                return json.dumps(
                    {"error": "http_error", "status": exc.response.status_code, "body": exc.response.text}
                )
            except Exception as exc:
                logger.exception("n8n trigger failed for %s", _path)
                return json.dumps({"error": str(exc)})

        _impl.__name__ = ident
        _impl.__doc__ = description
        tools.append(function_tool(_impl))
    return tools
