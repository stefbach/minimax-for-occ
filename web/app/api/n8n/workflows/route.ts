import { NextResponse } from "next/server";
import { listN8nWorkflows } from "@/lib/n8n";
import { TEMPLATES, VOICE_AGENT_WORKFLOW_TAG } from "@/lib/workflow-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,40}$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const activeParam = searchParams.get("active");
  const opts: { active?: boolean } = {};
  if (activeParam === "true") opts.active = true;
  else if (activeParam === "false") opts.active = false;
  try {
    const data = await listN8nWorkflows(opts);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

interface CreateBody {
  template?: string;
  slug?: string;
  /** Override the rendered workflow JSON if you want a custom build. */
  workflow?: Record<string, unknown>;
  /** Activate immediately after creation. */
  activate?: boolean;
}

/**
 * POST /api/n8n/workflows
 *
 * Body (one-of):
 *   { template: "<slug>", slug: "<unique-slug>", activate?: boolean }
 *   { workflow: { name, nodes, connections, settings }, activate?: boolean }
 *
 * Creates the workflow on n8n, tags it `voice-agent`, optionally activates it,
 * and returns the resulting row.
 */
export async function POST(req: Request) {
  const base = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.N8N_API_KEY;
  if (!base || !apiKey) {
    return NextResponse.json({ error: "N8N_BASE_URL or N8N_API_KEY missing" }, { status: 500 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  let workflow: Record<string, unknown>;
  if (body.workflow) {
    workflow = body.workflow;
  } else if (body.template) {
    const tpl = TEMPLATES.find((t) => t.slug === body.template);
    if (!tpl) {
      return NextResponse.json({ error: `unknown template: ${body.template}` }, { status: 400 });
    }
    const slug = (body.slug ?? tpl.slug).trim();
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        {
          error:
            "slug must be 3–40 chars, lowercase letters / digits / hyphens, starting with a letter or digit",
        },
        { status: 400 },
      );
    }
    workflow = tpl.build({ slug }) as Record<string, unknown>;
  } else {
    return NextResponse.json({ error: "provide either {template,slug} or {workflow}" }, { status: 400 });
  }

  const headers = {
    "X-N8N-API-KEY": apiKey,
    accept: "application/json",
    "content-type": "application/json",
  };

  // 1. Create the workflow
  const created = await fetch(`${base}/api/v1/workflows`, {
    method: "POST",
    headers,
    body: JSON.stringify(workflow),
  });
  if (!created.ok) {
    return NextResponse.json(
      { error: "n8n create failed", status: created.status, body: await created.text() },
      { status: 502 },
    );
  }
  const row = (await created.json()) as { id: string; name: string };

  // 2. Make sure a `voice-agent` tag exists, then attach.
  let tagId: string | null = null;
  try {
    const tagsRes = await fetch(`${base}/api/v1/tags`, { headers });
    if (tagsRes.ok) {
      const tags = (await tagsRes.json()) as { data?: { id: string; name: string }[] };
      tagId = tags.data?.find((t) => t.name === VOICE_AGENT_WORKFLOW_TAG)?.id ?? null;
    }
    if (!tagId) {
      const newTag = await fetch(`${base}/api/v1/tags`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: VOICE_AGENT_WORKFLOW_TAG }),
      });
      if (newTag.ok) tagId = (await newTag.json()).id ?? null;
    }
    if (tagId) {
      await fetch(`${base}/api/v1/workflows/${row.id}/tags`, {
        method: "PUT",
        headers,
        body: JSON.stringify([{ id: tagId }]),
      });
    }
  } catch {
    /* tagging is best-effort */
  }

  // 3. Optionally activate immediately
  if (body.activate) {
    await fetch(`${base}/api/v1/workflows/${row.id}/activate`, {
      method: "POST",
      headers,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      workflow: row,
      editor_url: `${base}/workflow/${row.id}`,
    },
    { status: 201 },
  );
}
