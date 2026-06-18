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
    .describe("Les directives complètes de l'agent, rédigées comme des instructions À l'agent (2e personne, impératif). C'est son system prompt."),
  description: z
    .string()
    .max(300)
    .optional()
    .describe("Résumé court (1 phrase) de ce que fait l'agent."),
  suggested_name: z
    .string()
    .max(60)
    .optional()
    .describe("Nom court suggéré pour l'agent, ex. « Relances RDV » ou « Suivi no-show »."),
});

function buildSystem(ctx: ChatContext): string {
  const sector = ctx.org_category
    ? `\nSecteur du client : ${ctx.org_category}. Adapte les exemples et le ton à ce métier.`
    : "";
  return `Tu es l'assistant qui aide à configurer un AGENT DE GESTION sur Axon. Un agent de gestion n'appelle PAS au téléphone : il exécute des automations (relances par email, messages WhatsApp, mises à jour de fiches dans une table). Son comportement est défini par ses « directives » (son system prompt).${sector}

Ton rôle : discuter avec l'opérateur pour comprendre ce que cet agent doit faire, puis rédiger ses directives.

Déroulé :
1. Pose des questions ciblées pour cerner : l'OBJECTIF (ex. relancer les no-shows), le TON (formel, chaleureux…), les CANAUX (email, WhatsApp, mise à jour de fiche), les RÈGLES (quand agir / ne pas agir, quoi dire, quand s'arrêter, langue), et ce qu'il faut PERSONNALISER avec les données de la fiche.
2. Dès que tu as de quoi rédiger, appelle l'outil \`propose_directives\` avec un system_prompt COMPLET et opérationnel, écrit comme des instructions adressées à l'agent (« Tu es… Ton objectif… Pour chaque contact… N'agis jamais si… »). Reformule en clair et demande confirmation.
3. N'appelle \`finalize_agent\` QUE lorsque l'opérateur valide explicitement (« go », « crée l'agent »). Ne finalise jamais dans le même tour qu'une nouvelle proposition.
4. Ne prétends jamais que l'agent est créé tant que finalize_agent n'a pas réussi.

Important : tu rédiges seulement les DIRECTIVES (le cerveau). Le branchement concret à une table / un email / un WhatsApp se fait ensuite dans la page Workflows — tu peux le mentionner mais tu ne le configures pas ici. Reste en français, sois concret.`;
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY manquante" }, { status: 500 });
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
        "Enregistre/met à jour les directives (system prompt) proposées pour l'agent de gestion. À appeler dès que tu as de quoi rédiger, avec des directives complètes.",
      inputSchema: directivesProposalSchema,
      execute: async (input) => ({ ok: true as const, directives: input }),
    }),
    finalize_agent: tool({
      description:
        "Crée l'agent de gestion avec les dernières directives proposées. À n'appeler qu'après validation explicite (« go »).",
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
