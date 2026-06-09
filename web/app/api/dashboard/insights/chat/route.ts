import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { type LeadsSource } from "@/lib/leads-source";
import { parseCallSystem } from "@/lib/call-system";
import { loadInsightsCalls } from "@/lib/insights/load-calls";
import { CHAT_TOOLS, executeChatTool } from "@/lib/insights/chat-tools";
import type { InsightsCallInput } from "@/lib/insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEEPSEEK_CHAT_URL =
  (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "") + "/chat/completions";
const MODEL = process.env.DEEPSEEK_INSIGHTS_MODEL ?? "deepseek-chat";
const MAX_TURNS = 6;

interface ChatMsg { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; tool_calls?: unknown }
interface Body {
  messages?: { role: "user" | "assistant"; content: string }[];
  from?: string; to?: string; direction?: string; leads_source?: string; system?: string; period_label?: string;
}

function systemPrompt(periodLabel: string, calls: InsightsCallInput[]): string {
  const withSummary = calls.filter((c) => (c.summary ?? "").trim().length > 10).length;
  const counts: Record<string, number> = {};
  for (const c of calls) counts[c.qualification_effective] = (counts[c.qualification_effective] ?? 0) + 1;
  return `Tu es un assistant analytique pour le directeur d'un call-center d'une clinique de chirurgie de l'obésité au Royaume-Uni (parcours NHS WMP S2). Tu réponds à des questions sur les appels entre des agents IA et des prospects.

Règles :
1. Réponds TOUJOURS en français professionnel et concis (2 à 6 phrases sauf si on demande plus de détails).
2. Cite toujours les call_id exacts quand tu fais référence à un appel.
3. Utilise les outils search_calls, get_call_detail, get_aggregated_stats pour creuser plutôt que d'inventer. N'appelle pas un outil si la réponse est déjà dans le contexte.
4. Si on te demande un script ou un counter-argument, marque-le clairement comme "Suggestion à valider".
5. Si la question dépasse les données disponibles, dis-le franchement.
6. Sois actionnable : préfère "appelle X aujourd'hui car Y" à "il faudrait peut-être réfléchir à…".

Contexte de la session :
Période : ${periodLabel}
Appels disponibles : ${calls.length} (dont ${withSummary} avec résumé exploitable)
Répartition par qualification :
${Object.entries(counts).map(([q, n]) => `- ${q} : ${n}`).join("\n")}`;
}

async function deepseek(messages: ChatMsg[], withTools: boolean): Promise<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY n'est pas configurée.");
  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 2048,
      messages,
      ...(withTools ? { tools: CHAT_TOOLS, tool_choice: "auto" } : {}),
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }> };
  const choice = data.choices?.[0];
  return { message: choice?.message ?? {}, finish_reason: choice?.finish_reason };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });

  let body: Body;
  try { body = (await request.json()) as Body; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const userMsgs = Array.isArray(body.messages) ? body.messages : [];
  if (userMsgs.length === 0) return NextResponse.json({ error: "no_messages" }, { status: 400 });

  const now = new Date();
  const to = body.to ? new Date(body.to) : now;
  const from = body.from ? new Date(body.from) : new Date(now.getTime() - 7 * 86400_000);
  const direction = body.direction && body.direction !== "all" ? body.direction : null;
  const leadsSource: LeadsSource = body.leads_source === "test" ? "test" : "prod";
  const system = parseCallSystem(body.system);
  const periodLabel = body.period_label?.trim() || "Période";

  const { inputs } = await loadInsightsCalls({ orgId, from, to, direction, leadsSource, system });

  const messages: ChatMsg[] = [
    { role: "system", content: systemPrompt(periodLabel, inputs) },
    ...userMsgs.map((m) => ({ role: m.role, content: m.content })),
  ];

  let toolCalls = 0;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { message, finish_reason } = await deepseek(messages, true);
      const calls = message.tool_calls ?? [];
      if (finish_reason !== "tool_calls" || calls.length === 0) {
        return NextResponse.json({ reply: (message.content ?? "").trim() || "Pas de réponse.", tool_calls: toolCalls });
      }
      // Echo the assistant tool-call turn, then answer each tool.
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls } as ChatMsg);
      for (const tc of calls) {
        toolCalls++;
        let argsObj: unknown = {};
        try { argsObj = JSON.parse(tc.function.arguments || "{}"); } catch { argsObj = {}; }
        const result = executeChatTool(tc.function.name, argsObj, inputs);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    }
    return NextResponse.json({ reply: "J'ai épuisé mon budget d'outils. Reformule ta question plus précisément.", tool_calls: toolCalls });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "chat_failed" }, { status: 500 });
  }
}
