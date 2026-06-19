/**
 * Anthropic client for the automation "brains".
 *
 * Every native automation embeds at least one AI step — a supervisor that
 * reasons over the run context (and, for the data controller, an agent that
 * calls Supabase tools). This module wraps the Anthropic Messages API over
 * plain fetch (no SDK dependency), with three entry points:
 *
 *   • generateText  — prompt in, text out (reports, summaries, routing).
 *   • analyzeFiles  — vision: classify / extract from PDFs and images.
 *   • runAgent      — tool-use loop: the model calls typed tools until done.
 *
 * Models match what the historical OCC n8n flows used, overridable per step.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export const DEFAULT_BRAIN_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_VISION_MODEL = "claude-sonnet-4-20250514";

export interface AnthropicCred {
  api_key?: string;
  apiKey?: string;
  default_model?: string;
}

export interface FileAttachment {
  /** base64-encoded bytes (no data: prefix). */
  data: string;
  /** e.g. application/pdf, image/png, image/jpeg. */
  mediaType: string;
  fileName?: string;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

function keyOf(cred: AnthropicCred): string {
  const k = cred.api_key ?? cred.apiKey ?? "";
  if (!k) throw new Error("anthropic credential missing api_key");
  return k;
}

function fileBlock(f: FileAttachment): ContentBlock {
  if (f.mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: f.mediaType, data: f.data } };
  }
  return { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } };
}

async function call(
  cred: AnthropicCred,
  body: Record<string, unknown>,
): Promise<{ text: string; raw: unknown }> {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": keyOf(cred),
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`);
  }
  const json = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  return { text: text.trim(), raw: json };
}

/** Prompt → text. Optional system message and attachments. */
export async function generateText(opts: {
  cred: AnthropicCred;
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  attachments?: FileAttachment[];
}): Promise<string> {
  const content: ContentBlock[] = [];
  for (const f of opts.attachments ?? []) content.push(fileBlock(f));
  content.push({ type: "text", text: opts.prompt });
  const { text } = await call(opts.cred, {
    model: opts.model ?? opts.cred.default_model ?? DEFAULT_BRAIN_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content }],
  });
  return text;
}

/** Vision: send files + a question, get the model's answer text. */
export async function analyzeFiles(opts: {
  cred: AnthropicCred;
  prompt: string;
  attachments: FileAttachment[];
  system?: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  return generateText({
    ...opts,
    model: opts.model ?? opts.cred.default_model ?? DEFAULT_VISION_MODEL,
    maxTokens: opts.maxTokens ?? 1024,
  });
}

// ── Agentic tool-use loop ───────────────────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Run a tool-using agent until it stops calling tools (or hits maxTurns).
 * Returns the final assistant text plus a transcript of tool calls made — the
 * model decides which tools to invoke, exactly like the n8n agent node.
 */
export async function runAgent(opts: {
  cred: AnthropicCred;
  system: string;
  prompt: string;
  tools: AgentTool[];
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
}): Promise<{ output: string; toolCalls: Array<{ name: string; input: unknown; result: unknown }> }> {
  const model = opts.model ?? opts.cred.default_model ?? DEFAULT_BRAIN_MODEL;
  const toolDefs = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: opts.prompt },
  ];
  const toolCalls: Array<{ name: string; input: unknown; result: unknown }> = [];
  const maxTurns = opts.maxTurns ?? 6;

  for (let turn = 0; turn < maxTurns; turn++) {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": keyOf(opts.cred),
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1500,
        system: opts.system,
        tools: toolDefs,
        messages,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`);
    }
    const json = (await r.json()) as {
      stop_reason?: string;
      content?: Array<Record<string, unknown>>;
    };
    const blocks = json.content ?? [];
    messages.push({ role: "assistant", content: blocks });

    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (json.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => String((b as { text?: string }).text ?? ""))
        .join("")
        .trim();
      return { output: text, toolCalls };
    }

    const results: unknown[] = [];
    for (const tu of toolUses) {
      const name = String(tu.name);
      const input = (tu.input as Record<string, unknown>) ?? {};
      const tool = byName.get(name);
      let result: unknown;
      try {
        result = tool ? await tool.handler(input) : { error: `unknown tool ${name}` };
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      toolCalls.push({ name, input, result });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { output: "(agent reached max turns)", toolCalls };
}
