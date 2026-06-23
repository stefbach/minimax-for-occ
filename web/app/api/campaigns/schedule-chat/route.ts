import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { NextResponse } from "next/server";
import { currentMembership, currentUser } from "@/lib/supabase-auth";
import { rateLimit } from "@/lib/rate-limit";
import { scheduleProposalSchema, normalizeProposal } from "@/lib/campaigns/schedule-proposal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = Number(process.env.SCHEDULE_CHAT_RATE_LIMIT_PER_MINUTE ?? 20);

// Context the wizard sends along so the agent reasons about THIS campaign:
// whether it's a continuous (table-backed) campaign — which unlocks
// relances/statuts/volume — and which timezone to default to.
interface ChatContext {
  mode?: "static" | "dynamic";
  default_timezone?: string | null;
  table_label?: string | null;
  status_column?: string | null;
  status_values?: string[];
  detected_relance_phases?: number | null;
  concurrency_limit?: number | null;
  org_category?: string | null;
}

function buildSystem(ctx: ChatContext): string {
  const dynamic = ctx.mode === "dynamic";
  const statusValues = ctx.status_values ?? [];
  const sectorLine = ctx.org_category
    ? `\nSecteur du client : ${ctx.org_category}. Adapte ton vocabulaire à ce métier (ex. « réservations » pour un restaurant/hôtel, « relances » pour un recouvrement, « rappels » pour une clinique), mais ne change RIEN à la mécanique de planification.`
    : "";
  return `Tu es l'assistant de planification de campagnes d'appels d'Axon. L'opérateur a déjà choisi QUI appelle (le numéro émetteur) et QUI appeler (la base de contacts). Ton SEUL rôle est de définir le « QUAND » : jours, fuseau horaire, plages horaires, et — pour les campagnes continues — la cadence de relances, les statuts ciblés et le volume.${sectorLine}

Déroulé attendu :
1. Discute avec l'opérateur en français, naturel et concis. Pose des questions seulement si une information indispensable manque (jours, heures, fuseau).
2. Dès que l'opérateur donne ou modifie un élément de planning, appelle l'outil \`propose_schedule\` avec la planification COMPLÈTE et à jour (jamais un fragment). Reformule ensuite en clair ce que ça produit et demande une confirmation explicite.
3. N'appelle \`finalize_campaign\` QUE lorsque l'opérateur valide explicitement (« go », « valide », « crée la campagne »). Ne finalise jamais dans le même tour qu'une nouvelle proposition : propose d'abord, attends le feu vert.
4. Ne prétends jamais que la campagne est créée tant que \`finalize_campaign\` n'a pas réussi.

Règles de planification :
- Le fuseau doit être un identifiant IANA valide (ex. « Maurice » → Indian/Mauritius, « UK »/« Royaume-Uni » → Europe/London, « France » → Europe/Paris). En cas de doute, demande.
- Les heures sont saisies en heure LOCALE du fuseau choisi.
- Jours : 0=Dimanche, 1=Lundi … 6=Samedi. « En semaine » = [1,2,3,4,5].
${dynamic
  ? `- Cette campagne est CONTINUE (tirée de la table « ${ctx.table_label ?? "sélectionnée"} »). Tu PEUX définir include_statuses (colonne statut : ${ctx.status_column ?? "inconnue"}), max_new_per_day, wave_size et relance_days_after_first (ex. [1,3,5] = relances à J+1, J+3, J+5).${typeof ctx.detected_relance_phases === "number" ? ` La table expose ${ctx.detected_relance_phases} phase(s) de relance détectée(s) ; n'en propose pas davantage.` : ""}
- STATUTS CIBLÉS — RÈGLE STRICTE : ${statusValues.length > 0
      ? `les seules valeurs valides présentes dans cette table sont : ${statusValues.map((v) => `« ${v} »`).join(", ")}. Quand l'opérateur décrit une cible (« les nouveaux », « les no-shows », « les annulés »…), traduis-la UNIQUEMENT vers ces valeurs exactes (respecte la casse). Si aucune valeur ne correspond clairement, demande des précisions au lieu d'inventer — ne mets jamais include_statuses à une valeur qui n'est pas dans cette liste.`
      : `aucune valeur de statut n'a pu être lue dans la table. Demande à l'opérateur les statuts exacts à cibler avant de remplir include_statuses, ou laisse include_statuses vide (= tous).`}`
  : `- Cette campagne est en mode APPEL UNIQUE (liste fixe). N'utilise PAS include_statuses, max_new_per_day, wave_size ni relance_days_after_first : les relances et le volume ne s'appliquent qu'aux campagnes continues basées sur une table. Si l'opérateur demande des relances, explique qu'il faut repasser à l'étape « Qui appeler » et choisir une table de contacts en mode continu.`}
- La concurrence (appels simultanés) au-delà de ${ctx.concurrency_limit ?? 5} dépasse le plan actuel : préviens l'opérateur si on monte plus haut.

Reste strictement sur le « quand ». Si on te demande de changer l'agent, le numéro ou la base, indique que ça se fait aux étapes précédentes du wizard.`;
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY manquante" }, { status: 500 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await currentMembership();
  if (!m) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rl = rateLimit(`schedule-chat:user:${user.id}`, RATE_LIMIT);
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

  const ctx: ChatContext = body.context ?? {};

  const deepseek = createOpenAICompatible({
    name: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  });

  const tools = {
    // Server-validated: normalize the proposal and hand it back. The wizard
    // reads the tool output to fill its live "Quand ?" recap. No DB write here
    // — creation only happens on explicit finalize.
    propose_schedule: tool({
      description:
        "Enregistre/met à jour la planification proposée (jours, fuseau, plages, et options continues). À appeler dès que l'opérateur donne ou modifie le planning, avec la planification complète.",
      inputSchema: scheduleProposalSchema,
      execute: async (input) => {
        const norm = normalizeProposal(input);
        if (!norm.ok) return { ok: false as const, error: norm.error };
        return { ok: true as const, schedule: norm.value };
      },
    }),
    // Client-side tool (no execute): the wizard intercepts this, validates that
    // steps 1-2 are complete, creates the campaign in draft, and returns the
    // result so the agent can confirm to the operator.
    finalize_campaign: tool({
      description:
        "Crée la campagne EN BROUILLON avec la dernière planification proposée. À n'appeler qu'après validation explicite de l'opérateur (« go »).",
      inputSchema: z.object({}),
    }),
  };

  const result = streamText({
    model: deepseek(process.env.SCHEDULE_CHAT_MODEL ?? "deepseek-v4-flash"),
    system: buildSystem(ctx),
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
