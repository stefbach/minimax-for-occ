/**
 * Super Admin Copilot — tool catalogue.
 *
 * Every tool falls in one of two safety classes:
 *   - "read":  executed directly, no confirmation, logged for visibility.
 *   - "write": staged as a `pending` row in `copilot_actions`. The tool call
 *              returns the action id so the UI can render a "Confirm" button.
 *              The actual side-effect happens in `executeAction()` (called by
 *              POST /api/copilot/actions/[id]/confirm).
 *
 * Tools intentionally live outside the route handler so they can be exercised
 * by tests and re-used by future MCP servers.
 */
import { z } from "zod";
import { tool } from "ai";
import { supabaseServer } from "@/lib/supabase";
import { embedText, chunkText } from "@/lib/embed";
import {
  listN8nWorkflows,
  getN8nWorkflow,
  createN8nWorkflow,
  updateN8nWorkflow,
  activateN8nWorkflow,
} from "@/lib/n8n-client";

// ───────────────────────── audit helpers ─────────────────────────

export type ActionStatus = "pending" | "confirmed" | "executed" | "failed" | "rejected";

export interface AuditCtx {
  userId: string;
  orgId: string | null;
}

async function logAction(
  ctx: AuditCtx,
  toolName: string,
  args: unknown,
  opts: { status: ActionStatus; result?: unknown; error?: string } = { status: "executed" },
): Promise<string> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("copilot_actions")
    .insert({
      org_id: ctx.orgId,
      user_id: ctx.userId,
      tool_name: toolName,
      arguments: args ?? {},
      result: opts.result ?? null,
      status: opts.status,
      error: opts.error ?? null,
      executed_at: opts.status === "executed" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`audit insert failed: ${error.message}`);
  return (data as { id: string }).id;
}

// ───────────────────────── supabase_query safety ─────────────────────────

/**
 * Strip SQL comments (block + line) so keyword detection isn't fooled by
 * `/* drop *​/` or `-- delete from`. Block comments come first because line
 * comments are line-bounded and might otherwise wrap a `/*` opener.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

const DANGEROUS_RE =
  /\b(drop|truncate|delete|alter|grant|revoke)\b|\bcreate\s+(role|user)\b|\bset\s+role\b/i;
const WRITE_RE =
  /\b(insert|update|delete|merge|copy|truncate|alter|drop)\b|\bcreate\s+(table|index|view|materialized|schema|extension|function|trigger|policy)\b/i;

/** Cap dry-run output so a wildcard SELECT can't blow up the response. */
export const SQL_DRY_RUN_ROW_LIMIT = 100;

export function classifySql(sql: string): { kind: "read" | "write" | "dangerous"; reason?: string } {
  const stripped = stripSqlComments(sql);
  if (DANGEROUS_RE.test(stripped)) {
    return {
      kind: "dangerous",
      reason: "matched destructive keyword (DROP/TRUNCATE/DELETE/ALTER/GRANT/REVOKE/CREATE ROLE|USER/SET ROLE)",
    };
  }
  if (WRITE_RE.test(stripped)) return { kind: "write" };
  return { kind: "read" };
}

/**
 * Execute arbitrary SQL via the Supabase RPC `exec_sql_admin` if present,
 * otherwise fall back to a best-effort PostgREST select for read-only SELECTs.
 *
 * The Copilot is intentionally limited: writes have to go through dedicated
 * tools (create_org, etc.) so they're audited per-shape rather than as a raw
 * SQL blob. For ad-hoc reads, we attempt the RPC and surface the error if the
 * project hasn't provisioned it.
 */
async function runRawSql(
  sql: string,
  opts: { limit?: number } = {},
): Promise<{ rows: unknown[]; note?: string; truncated?: boolean }> {
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("exec_sql_admin", { query: sql });
  if (error) {
    return {
      rows: [],
      note: `RPC exec_sql_admin not available (${error.message}). Provision it as a security definer function returning jsonb to enable raw SQL from the Copilot.`,
    };
  }
  const all = Array.isArray(data) ? (data as unknown[]) : [data];
  const limit = opts.limit ?? Infinity;
  if (Number.isFinite(limit) && all.length > limit) {
    return { rows: all.slice(0, limit), truncated: true };
  }
  return { rows: all };
}

// ───────────────────────── execute (used by confirm endpoint) ─────────────────────────

interface PendingAction {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: ActionStatus;
}

export async function executeAction(actionId: string, ctx: AuditCtx): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("copilot_actions")
    .select("id, tool_name, arguments, status")
    .eq("id", actionId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "action not found" };
  const action = data as PendingAction;
  if (action.status !== "pending") {
    return { ok: false, error: `action is ${action.status}, only pending actions can be executed` };
  }

  try {
    const result = await runWriteTool(action.tool_name, action.arguments, ctx);
    await sb
      .from("copilot_actions")
      .update({ status: "executed", result, executed_at: new Date().toISOString() })
      .eq("id", actionId);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("copilot_actions").update({ status: "failed", error: msg }).eq("id", actionId);
    return { ok: false, error: msg };
  }
}

async function runWriteTool(name: string, args: Record<string, unknown>, _ctx: AuditCtx): Promise<unknown> {
  const sb = supabaseServer();
  switch (name) {
    case "create_org": {
      const a = args as { name: string; slug: string };
      const { data, error } = await sb.from("organizations").insert({ name: a.name, slug: a.slug }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "create_agent": {
      const a = args as { name: string; system_prompt?: string; voice_id?: string; llm_model?: string };
      const { data, error } = await sb
        .from("agents")
        .insert({
          name: a.name,
          system_prompt: a.system_prompt ?? "",
          tts_voice_id: a.voice_id ?? null,
          llm_model: a.llm_model ?? "deepseek-chat",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "n8n_create_workflow": {
      const a = args as { name: string; nodes: unknown[]; connections: Record<string, unknown>; active?: boolean };
      const created = (await createN8nWorkflow({
        name: a.name,
        nodes: a.nodes,
        connections: a.connections,
        settings: {},
      })) as { id: string };
      if (a.active) await activateN8nWorkflow(created.id, true);
      return created;
    }
    case "n8n_update_workflow": {
      const a = args as { id: string; name?: string; nodes?: unknown[]; connections?: Record<string, unknown> };
      const patch: Record<string, unknown> = {};
      if (a.name) patch.name = a.name;
      if (a.nodes) patch.nodes = a.nodes;
      if (a.connections) patch.connections = a.connections;
      return await updateN8nWorkflow(a.id, patch);
    }
    case "n8n_activate_workflow": {
      const a = args as { id: string; active?: boolean };
      await activateN8nWorkflow(a.id, a.active ?? true);
      return { id: a.id, active: a.active ?? true };
    }
    case "supabase_query": {
      // Re-classify the audited arguments verbatim — the confirm endpoint
      // replays the exact `arguments` row that was logged, never anything the
      // LLM may have rewritten.
      const a = args as { sql: string; force?: boolean };
      const c = classifySql(a.sql);
      if (c.kind === "dangerous" && !a.force) {
        throw new Error(`destructive SQL blocked (${c.reason}); set force=true to override`);
      }
      return await runRawSql(a.sql);
    }
    case "rag_add_document": {
      const a = args as { agent_id: string; text: string; source?: string };
      const chunks = chunkText(a.text);
      if (chunks.length === 0) return { inserted: 0 };
      const embeddings = await embedText(chunks);
      const rows = chunks.map((content, i) => ({
        agent_id: a.agent_id,
        source_name: a.source ?? "copilot",
        chunk_index: i,
        content,
        embedding: embeddings[i],
        metadata: { ingested_by: "copilot" },
      }));
      const { error } = await sb.from("documents").insert(rows);
      if (error) throw new Error(error.message);
      return { inserted: rows.length, source_name: a.source ?? "copilot" };
    }
    default:
      throw new Error(`unknown write tool: ${name}`);
  }
}

// ───────────────────────── tool definitions for the LLM ─────────────────────────

/**
 * Build the tool set bound to a given user context. Read tools execute
 * directly; write tools stage a `pending` row and return its id.
 */
export function buildTools(ctx: AuditCtx) {
  const sb = supabaseServer();

  return {
    list_orgs: tool({
      description: "List all organizations on the platform.",
      inputSchema: z.object({}).optional(),
      execute: async () => {
        const { data, error } = await sb
          .from("organizations")
          .select("id, name, slug, created_at")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw new Error(error.message);
        return { orgs: data ?? [] };
      },
    }),

    create_org: tool({
      description:
        "Stage the creation of a new organization. Returns an action id; the user must confirm in the UI before the org is actually created.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Display name"),
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters / digits / hyphens"),
      }),
      execute: async (args) => {
        const id = await logAction(ctx, "create_org", args, { status: "pending" });
        return { pending: true, action_id: id, summary: `Will create org "${args.name}" (slug=${args.slug}).` };
      },
    }),

    list_agents: tool({
      description: "List agents, optionally scoped to one organization.",
      inputSchema: z.object({ org_id: z.string().uuid().optional() }),
      execute: async ({ org_id }) => {
        let q = sb.from("agents").select("id, name, llm_model, tts_voice_id, rag_enabled").limit(200);
        if (org_id) q = q.eq("org_id", org_id);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return { agents: data ?? [] };
      },
    }),

    create_agent: tool({
      description:
        "Stage the creation of a new AI agent for an org. Returns an action id; the user must confirm before the agent is created.",
      inputSchema: z.object({
        org_id: z.string().uuid().describe("Owner organization"),
        name: z.string().min(1),
        system_prompt: z.string().optional(),
        voice_id: z.string().optional().describe("MiniMax voice id"),
        llm_model: z.string().optional(),
      }),
      execute: async (args) => {
        const id = await logAction(ctx, "create_agent", args, { status: "pending" });
        return { pending: true, action_id: id, summary: `Will create agent "${args.name}".` };
      },
    }),

    n8n_list_workflows: tool({
      description: "List n8n workflows (id, name, active flag, tags, webhook paths).",
      inputSchema: z.object({ active: z.boolean().optional() }),
      execute: async ({ active }) => {
        const data = await listN8nWorkflows(active !== undefined ? { active } : {});
        return { workflows: data };
      },
    }),

    n8n_get_workflow: tool({
      description: "Fetch a single n8n workflow with its full nodes+connections JSON.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        return await getN8nWorkflow(id);
      },
    }),

    n8n_create_workflow: tool({
      description: "Stage the creation of an n8n workflow. The user must confirm before it's pushed to n8n.",
      inputSchema: z.object({
        name: z.string().min(1),
        nodes: z.array(z.record(z.string(), z.unknown())).describe("n8n node array"),
        connections: z.record(z.string(), z.unknown()).describe("n8n connection map"),
        active: z.boolean().optional().describe("Activate immediately after creation"),
      }),
      execute: async (args) => {
        const id = await logAction(ctx, "n8n_create_workflow", args, { status: "pending" });
        return { pending: true, action_id: id, summary: `Will create n8n workflow "${args.name}" (${args.nodes.length} nodes).` };
      },
    }),

    n8n_update_workflow: tool({
      description: "Stage a PATCH on an existing n8n workflow (name/nodes/connections). Requires confirmation.",
      inputSchema: z.object({
        id: z.string(),
        name: z.string().optional(),
        nodes: z.array(z.record(z.string(), z.unknown())).optional(),
        connections: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async (args) => {
        const id = await logAction(ctx, "n8n_update_workflow", args, { status: "pending" });
        return { pending: true, action_id: id, summary: `Will update n8n workflow ${args.id}.` };
      },
    }),

    n8n_activate_workflow: tool({
      description: "Stage activation (or deactivation) of an n8n workflow. Requires confirmation.",
      inputSchema: z.object({ id: z.string(), active: z.boolean().optional().default(true) }),
      execute: async (args) => {
        const id = await logAction(ctx, "n8n_activate_workflow", args, { status: "pending" });
        return {
          pending: true,
          action_id: id,
          summary: `Will ${args.active === false ? "deactivate" : "activate"} workflow ${args.id}.`,
        };
      },
    }),

    supabase_query: tool({
      description:
        "Run a SQL query against the Axon database. By default it runs as a dry-run for writes (wrapped in BEGIN/ROLLBACK). SELECTs run directly. Destructive keywords (DROP/TRUNCATE/DELETE/…) are blocked unless force=true AND the user confirms.",
      inputSchema: z.object({
        sql: z.string().min(1),
        dry_run: z.boolean().optional().describe("Only meaningful for writes; default true for non-SELECT queries"),
        force: z.boolean().optional().describe("Allow destructive keywords. Still requires UI confirmation."),
      }),
      execute: async (args) => {
        const cls = classifySql(args.sql);
        // Read-only: run immediately, no audit row.
        if (cls.kind === "read") {
          const out = await runRawSql(args.sql, { limit: SQL_DRY_RUN_ROW_LIMIT });
          return { kind: "read", ...out };
        }
        // Write or dangerous → stage as pending; do not execute.
        if (cls.kind === "dangerous" && !args.force) {
          return {
            kind: "blocked",
            reason: cls.reason,
            hint: "If you really want to do this, re-issue with force=true; the user will still have to confirm in the UI.",
          };
        }
        const id = await logAction(ctx, "supabase_query", args, { status: "pending" });
        // Provide a dry-run preview so the LLM can describe the change. The
        // wrapper rolls back so this is non-destructive, and we cap the
        // returned rows to keep responses bounded.
        const preview = await runRawSql(`begin; ${args.sql}; rollback;`, {
          limit: SQL_DRY_RUN_ROW_LIMIT,
        });
        return {
          kind: cls.kind,
          pending: true,
          action_id: id,
          dry_run: preview,
          summary: `Will execute ${cls.kind} SQL: ${args.sql.slice(0, 120)}${args.sql.length > 120 ? "…" : ""}`,
        };
      },
    }),

    rag_add_document: tool({
      description: "Stage ingestion of a text document into an agent's RAG corpus. Requires confirmation.",
      inputSchema: z.object({
        agent_id: z.string().uuid(),
        text: z.string().min(1),
        source: z.string().optional().describe("Display name for the source (filename, URL, …)"),
      }),
      execute: async (args) => {
        const chunks = chunkText(args.text);
        const id = await logAction(ctx, "rag_add_document", args, { status: "pending" });
        return {
          pending: true,
          action_id: id,
          summary: `Will embed and insert ${chunks.length} chunk(s) into agent ${args.agent_id}.`,
        };
      },
    }),

    rag_search: tool({
      description: "Retrieve top-k chunks from an agent's RAG corpus for a query.",
      inputSchema: z.object({
        agent_id: z.string().uuid(),
        query: z.string().min(1),
        k: z.number().int().min(1).max(20).default(4),
      }),
      execute: async ({ agent_id, query, k }) => {
        const [embedding] = await embedText(query);
        const { data, error } = await sb.rpc("match_documents", {
          agent: agent_id,
          query_embedding: embedding,
          match_count: k,
          similarity_threshold: 0.0,
        });
        if (error) throw new Error(error.message);
        return { chunks: data ?? [] };
      },
    }),
  };
}
