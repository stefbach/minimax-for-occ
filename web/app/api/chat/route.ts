import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { embedText } from "@/lib/embed";
import type { Agent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY missing" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
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

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const model = agent?.llm_model || "gpt-4o-mini";

  const result = streamText({
    model: openai(model),
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
