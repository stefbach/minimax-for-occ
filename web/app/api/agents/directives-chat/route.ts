import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { NextResponse } from "next/server";
import { currentMembership, currentUser } from "@/lib/supabase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = Number(process.env.DIRECTIVES_CHAT_RATE_LIMIT_PER_MINUTE ?? 20);

interface ChatContext {
  org_category?: string | null;
}

// The directives the assistant drafts for the management agent it's helping
// configure. Local to this route — Next.js rejects non-route exports here.
const directivesProposalSchema = z.object({
  system_prompt: z
    .string()
    .min(20)
    .max(8000)
    .describe("The agent's full directives, written as instructions TO the agent (2nd person, imperative). This is its system prompt."),
  description: z
    .string()
    .max(300)
    .optional()
    .describe("Short one-sentence summary of what the agent does."),
  suggested_name: z
    .string()
    .max(60)
    .optional()
    .describe("Short suggested name for the agent, e.g. 'Appointment follow-ups' or 'No-show tracking'."),
});

function buildSystem(ctx: ChatContext): string {
  const sector = ctx.org_category
    ? `\nClient sector: ${ctx.org_category}. Adapt examples and tone to this industry.`
    : "";
  return `You are the assistant that helps configure a MANAGEMENT AGENT on Axon. A management agent does NOT make phone calls: it runs automations (email follow-ups, WhatsApp messages, record updates in a data table). Its behaviour is defined by its "directives" (its system prompt).${sector}

Your role: discuss with the operator to understand what this agent should do, then draft its directives.

Process:
1. Ask targeted questions to clarify: the OBJECTIVE (e.g. follow up no-shows), the TONE (formal, warm…), the CHANNELS (email, WhatsApp, record update), the RULES (when to act / not act, what to say, when to stop, language), and what needs to be PERSONALISED using record data.
2. As soon as you have enough to write, call the \`propose_directives\` tool with a COMPLETE, operational system_prompt written as instructions addressed to the agent ("You are… Your objective… For each contact… Never act if…"). Rephrase clearly and ask for confirmation.
3. Only call \`finalize_agent\` when the operator explicitly approves ("go", "create the agent"). Never finalize in the same turn as a new proposal.
4. Never claim the agent is created until finalize_agent has succeeded.

Important: you only draft the DIRECTIVES (the brain). Connecting to a table / email / WhatsApp is done afterwards in the Workflows page — you can mention it but you don't configure it here. Be concrete.`;
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY missing" }, { status: 500 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await currentMembership();
  if (!m) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rl = rateLimit(`directives-chat:user:${user.id}`, RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() } },
    );
  }

  let body: { messages: UIMessage[]; context?: ChatContext };
  try {
    body = (await req.json()) as { messages: UIMessage[]; context?: ChatContext };
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const deepseek = createOpenAICompatible({
    name: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  });

  const tools = {
    propose_directives: tool({
      description:
        "Save/update the proposed directives (system prompt) for the management agent. Call as soon as you have enough to write, with complete directives.",
      inputSchema: directivesProposalSchema,
      execute: async (input) => ({ ok: true as const, directives: input }),
    }),
    finalize_agent: tool({
      description:
        "Create the management agent with the latest proposed directives. Only call after explicit approval ('go').",
      inputSchema: z.object({}),
    }),
  };

  const result = streamText({
    model: deepseek(process.env.DIRECTIVES_CHAT_MODEL ?? "deepseek-v4-flash"),
    system: buildSystem(body.context ?? {}),
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
