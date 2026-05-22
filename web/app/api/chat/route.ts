import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { embedText } from "@/lib/embed";
import type { Agent } from "@/lib/types";
import { requestOrgId } from "@/lib/request-org";
import { recordUsage, estimateCostCents } from "@/lib/billing";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_RATE_LIMIT = Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE ?? 30);

const DEFAULT_PROMPT =
  "Tu es un assistant utile, multilingue (FR/EN). Réponds dans la langue de l'utilisateur. Sois concis.";

async function loadAgent(agentId: string | null): Promise<Agent | null> {
  if (!agentId || !hasSupabase()) return null;
  const sb = supabaseServer();
  const { data } = await sb.from("agents").select("*").eq("id", agentId).maybeSingle();
  return (data as Agent | null) ?? null;
}

async function ragContext(agent: Agent, lastUserText: string): Promise<string> {
  if (!agent.rag_enabled || !lastUserText.trim() || !hasSupabase()) return "";
  try {
    const [embedding] = await embedText(lastUserText);
    const sb = supabaseServer();
    const { data, error } = await sb.rpc("match_documents", {
      agent: agent.id,
      query_embedding: embedding,
      match_count: agent.rag_top_k ?? 4,
      similarity_threshold: 0.3,
    });
    if (error || !data) return "";
    const rows = data as Array<{ source_name: string; content: string; similarity: number }>;
    if (rows.length === 0) return "";
    return [
      "Contexte récupéré depuis la base documentaire (utilise-le quand pertinent, cite la source) :",
      ...rows.map((r, i) => `[${i + 1}] (${r.source_name}, similarité=${r.similarity.toFixed(2)})\n${r.content}`),
    ].join("\n\n");
  } catch {
    return "";
  }
}

/** Map legacy OpenAI/Anthropic model names stored in agent rows to DeepSeek equivalents. */
function resolveDeepSeekModel(agentModel: string | undefined): string {
  const m = agentModel ?? "";
  if (m.startsWith("deepseek-")) return m;
  // reasoning models → deepseek-reasoner
  if (m === "o1" || m === "o1-mini" || m === "o3-mini") return "deepseek-reasoner";
  // everything else → deepseek-chat
  return "deepseek-chat";
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return new Response(
      JSON.stringify({ error: "DEEPSEEK_API_KEY missing" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  // Per-user rate limit, falling back to IP for unauthenticated callers.
  const user = await currentUser().catch(() => null);
  const rlKey = user ? `chat:user:${user.id}` : `chat:ip:${clientIp(req)}`;
  const rl = rateLimit(rlKey, CHAT_RATE_LIMIT);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString(),
      },
    });
  }

  const { messages, agent_id } = (await req.json()) as {
    messages: UIMessage[];
    agent_id?: string;
  };

  const agent = await loadAgent(agent_id ?? null);
  const systemBase = agent?.system_prompt?.trim() || DEFAULT_PROMPT;
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText =
    lastUserMsg?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n") ?? "";

  const rag = agent ? await ragContext(agent, lastUserText) : "";
  const system = rag ? `${systemBase}\n\n${rag}` : systemBase;

  const deepseek = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  });
  const model = resolveDeepSeekModel(agent?.llm_model);

  // Resolve the org for billing up-front (cookies are still readable here).
  let billingOrgId: string | null = null;
  try {
    billingOrgId = await requestOrgId(req);
  } catch {
    /* unauth or no membership — skip billing */
  }

  const result = streamText({
    model: deepseek(model),
    system,
    messages: await convertToModelMessages(messages),
    onFinish: async ({ totalUsage }) => {
      try {
        const input = totalUsage?.inputTokens ?? 0;
        const output = totalUsage?.outputTokens ?? 0;
        const total = (input ?? 0) + (output ?? 0);
        if (billingOrgId && total > 0) {
          await recordUsage(
            billingOrgId,
            "llm_tokens",
            total,
            estimateCostCents("llm_tokens", total),
            { model, input_tokens: input, output_tokens: output, agent_id: agent?.id ?? null },
          );
        }
      } catch {
        /* never let billing tracking break the stream */
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
