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
