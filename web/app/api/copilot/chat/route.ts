import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import { currentMembership, currentUser } from "@/lib/supabase-auth";
import { buildTools } from "@/lib/copilot/tools";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COPILOT_RATE_LIMIT = Number(process.env.COPILOT_RATE_LIMIT_PER_MINUTE ?? 10);

const SYSTEM = `Tu es le Copilote Super Admin d'Axon Voice Platform.
Tu peux piloter directement la plateforme via les tools mis à ta disposition :
- gestion des organisations et agents IA
- workflows n8n (lister, lire, créer, mettre à jour, activer)
- SQL Supabase (read-only par défaut, écritures via tools dédiés)
- RAG (ajouter des documents à un agent, faire une recherche)

Règles importantes :
1. Les tools de lecture s'exécutent immédiatement.
2. Les tools d'écriture renvoient un \`action_id\` et un \`summary\` — tu DOIS expliquer
   à l'utilisateur ce qui va se passer puis l'inviter explicitement à confirmer
   en cliquant sur le bouton "Confirmer" dans l'UI. Ne prétends jamais qu'une
   action a été exécutée alors qu'elle est en \`pending\`.
3. Pour les requêtes SQL : préfère toujours un SELECT ciblé d'abord. Si tu dois
   modifier quelque chose, propose un INSERT/UPDATE minimal, jamais de DELETE/DROP
   sans demander confirmation explicite (et le flag force=true).
4. Réponds dans la langue de l'utilisateur (FR par défaut). Sois concis, factuel
   et montre les ids/slugs pour que l'utilisateur puisse copier-coller.`;

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY missing" }, { status: 500 });
  }

  // ── auth: super_admin only ─────────────────────────────
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await currentMembership();
  if (!m || m.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden — super_admin only" }, { status: 403 });
  }

  // Per-user rate limit (copilot tools fan out to expensive backends).
  const rl = rateLimit(`copilot-chat:user:${user.id}`, COPILOT_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      },
    );
  }

  let body: { messages: UIMessage[] };
  try {
    body = (await req.json()) as { messages: UIMessage[] };
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const deepseek = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
  const tools = buildTools({ userId: user.id, orgId: m.org_id ?? null });

  const result = streamText({
    model: deepseek("deepseek-chat"),
    system: SYSTEM,
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
