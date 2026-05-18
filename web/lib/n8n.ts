import type { N8nWorkflowSummary } from "./types";

interface RawN8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes?: Array<{ type?: string; parameters?: Record<string, unknown> }>;
  tags?: Array<{ name?: string }>;
}

function workflowSummary(wf: RawN8nWorkflow): N8nWorkflowSummary {
  const paths: string[] = [];
  for (const node of wf.nodes ?? []) {
    if (typeof node.type === "string" && node.type.toLowerCase().includes("webhook")) {
      const p = (node.parameters as { path?: string } | undefined)?.path;
      if (p) paths.push(p);
    }
  }
  return {
    id: wf.id,
    name: wf.name,
    active: !!wf.active,
    tags: (wf.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
    webhook_paths: paths,
  };
}

export async function listN8nWorkflows(opts: { active?: boolean } = {}): Promise<N8nWorkflowSummary[]> {
  const base = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.N8N_API_KEY;
  if (!base || !apiKey) {
    throw new Error("N8N_BASE_URL or N8N_API_KEY missing");
  }
  const params = new URLSearchParams();
  if (opts.active !== undefined) params.set("active", String(opts.active));
  const res = await fetch(`${base}/api/v1/workflows?${params}`, {
    headers: { "X-N8N-API-KEY": apiKey, accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`n8n list failed: ${res.status}`);
  const json = (await res.json()) as { data?: RawN8nWorkflow[] };
  return (json.data ?? []).map(workflowSummary);
}

function n8nHeaders(): Record<string, string> {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) throw new Error("N8N_API_KEY missing");
  return {
    "X-N8N-API-KEY": apiKey,
    accept: "application/json",
    "content-type": "application/json",
  };
}

function n8nBase(): string {
  const base = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("N8N_BASE_URL missing");
  return base;
}

/** Full raw workflow JSON for a single n8n workflow. */
export async function getN8nWorkflow(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${n8nBase()}/api/v1/workflows/${encodeURIComponent(id)}`, {
    headers: n8nHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`n8n get failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Create a workflow from a raw payload (caller must include name, nodes, connections, settings). */
export async function createN8nWorkflow(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${n8nBase()}/api/v1/workflows`, {
    method: "POST",
    headers: n8nHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`n8n create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Patch an existing workflow (name/nodes/connections/settings). */
export async function updateN8nWorkflow(
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${n8nBase()}/api/v1/workflows/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: n8nHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`n8n update failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function activateN8nWorkflow(id: string, active = true): Promise<void> {
  const action = active ? "activate" : "deactivate";
  const res = await fetch(`${n8nBase()}/api/v1/workflows/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: n8nHeaders(),
  });
  if (!res.ok) throw new Error(`n8n ${action} failed: ${res.status} ${await res.text()}`);
}

export async function triggerN8nWebhook(webhookPath: string, payload: unknown): Promise<{
  status: number;
  body: unknown;
}> {
  const base = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("N8N_BASE_URL missing");
  const webhookBase = process.env.N8N_WEBHOOK_BASE_URL?.replace(/\/$/, "") ?? `${base}/webhook`;
  const url = `${webhookBase}/${webhookPath.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}
