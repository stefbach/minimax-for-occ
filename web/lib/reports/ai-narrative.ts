/**
 * AI-generated narrative sections for the pilotage reports.
 *
 * We give DeepSeek v4-flash the raw aggregates and ask it to write the lead
 * paragraph, the three exec messages (good / warn / info), the vigilance
 * flags and one-line recommendations — in French, in the same crisp tone
 * as the NHS pilotage report Wati uses as a reference.
 *
 * Strict JSON output (response_format json_object) so we never have to parse
 * prose. On failure we return a deterministic fallback so the report still
 * renders.
 */

import type {
  CallAggregates,
  LeadActionRow,
} from "./data";
import type { ExecMessage, VigilanceFlag } from "./types";

const DEEPSEEK_CHAT_URL =
  (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "") +
  "/chat/completions";

export interface NarrativeOutput {
  synthese: string;
  execMessages: ExecMessage[];
  vigilance: VigilanceFlag[];
  methodNote: string;
}

interface NarrativeContext {
  reportTitle: string;
  periodLabel: string;
  agg: CallAggregates;
  callbacksDue: number;
  overDialed: number;
  /** Sample of names the AI can cite (top 5). */
  topCallbackNames: string[];
}

const SYSTEM_PROMPT = [
  "Tu rédiges les sections narratives d'un rapport de pilotage opérationnel",
  "pour un centre d'appels santé (Obesity Care Clinic). Ton : factuel, dense,",
  "francais soutenu, phrases courtes. Pas de mots vagues. Pas d'emoji. Cite",
  "des chiffres exacts quand ils sont fournis. Réponds UNIQUEMENT en JSON",
  "strict, conforme au schéma fourni.",
].join(" ");

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["synthese", "execMessages", "vigilance", "methodNote"],
  properties: {
    synthese: {
      type: "string",
      description:
        "Paragraphe de synthèse exécutive (3-4 phrases, ~80 mots). Pose le verdict, identifie la zone de valeur et la zone à risque.",
    },
    execMessages: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        required: ["tone", "heading", "big", "body"],
        properties: {
          tone: { type: "string", enum: ["good", "warn", "info", "bad"] },
          heading: { type: "string" },
          big: { type: "string", description: "Chiffre ou mot-clé court (ex: '84 %', '13', '+12 RDV')" },
          body: { type: "string", description: "1-2 phrases factuelles" },
        },
      },
    },
    vigilance: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        required: ["tone", "heading", "body"],
        properties: {
          tone: { type: "string", enum: ["bad", "warn", "info"] },
          heading: { type: "string" },
          body: { type: "string" },
          fix: { type: "string", description: "Levier recommandé, 1 phrase" },
        },
      },
    },
    methodNote: {
      type: "string",
      description: "Note méthodologique courte (2-3 phrases) au pied du rapport.",
    },
  },
};

function buildUserPrompt(ctx: NarrativeContext): string {
  const a = ctx.agg;
  const pctDecroche = a.total > 0 ? Math.round((100 * a.answered) / a.total) : 0;
  const pctProductif =
    a.answered > 0
      ? Math.round((100 * (a.rappel + a.rdvConfirme + a.passerHumain)) / a.answered)
      : 0;
  const sampleNames = ctx.topCallbackNames.slice(0, 5).join(", ") || "—";

  return [
    `Rapport demandé : "${ctx.reportTitle}" · Période : ${ctx.periodLabel}`,
    "",
    "DONNÉES OBSERVÉES (ne pas inventer) :",
    `- Total appels passés : ${a.total}`,
    `- Décrochés : ${a.answered} (${pctDecroche}%)`,
    `- Non décrochés : ${a.unanswered}`,
    `- Répondeurs (REPONDEUR) : ${a.voicemail}`,
    `- Pas de réponse (PAS DE REPONSE) : ${a.noAnswer}`,
    `- RAPPEL programmé : ${a.rappel}`,
    `- RDV confirmé : ${a.rdvConfirme}`,
    `- À passer à humain : ${a.passerHumain}`,
    `- PAS INTERESSE : ${a.pasInteresse}`,
    `- FAUX NUMERO : ${a.fauxNumero}`,
    `- Taux de qualif productive (RAPPEL+RDV+humain / décrochés) : ${pctProductif}%`,
    `- Durée moyenne des appels décrochés : ${a.avgDurationSecs}s`,
    `- Coût total estimé (cents) : ${a.totalCostCents}`,
    `- Audio disponible sur ${a.withRecording} appels (sur ${a.answered} décrochés)`,
    "",
    "ACTIONS EN ATTENTE :",
    `- RAPPEL en attente (échéance passée) : ${ctx.callbacksDue}`,
    `- Leads sur-appelés (8+ tentatives, pas de qualif) : ${ctx.overDialed}`,
    `- Exemples de noms à rappeler aujourd'hui : ${sampleNames}`,
    "",
    "ATTENDUS :",
    "1. synthese : verdict en 3-4 phrases (ce qui marche, ce qui bloque, où agir).",
    "2. execMessages : 3 messages factuels — un 'good' (succès), un 'warn' (goulot), un 'info' (point d'attention récupérable).",
    "3. vigilance : 2 à 4 alertes — anomalies à corriger (taux décroché bas? sur-appel? cadence? coût?).",
    "4. methodNote : 2-3 phrases sur la méthode de calcul et les hypothèses.",
  ].join("\n");
}

export async function generateNarrative(ctx: NarrativeContext): Promise<NarrativeOutput> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallbackNarrative(ctx);

  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `Schéma de réponse (JSON STRICT) : ${JSON.stringify(RESPONSE_SCHEMA)}`,
              "",
              buildUserPrompt(ctx),
            ].join("\n"),
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[reports/ai-narrative] DeepSeek HTTP ${res.status}`);
      return fallbackNarrative(ctx);
    }
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = j.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as NarrativeOutput;
    if (!parsed || !parsed.synthese || !Array.isArray(parsed.execMessages)) {
      return fallbackNarrative(ctx);
    }
    return parsed;
  } catch (e) {
    console.warn(`[reports/ai-narrative] error: ${e instanceof Error ? e.message : e}`);
    return fallbackNarrative(ctx);
  }
}

/** Deterministic fallback when DeepSeek is unavailable. The report still
 *  renders, just with a less polished narrative. */
function fallbackNarrative(ctx: NarrativeContext): NarrativeOutput {
  const a = ctx.agg;
  const pctDecroche = a.total > 0 ? Math.round((100 * a.answered) / a.total) : 0;
  const pctProductif =
    a.answered > 0
      ? Math.round((100 * (a.rappel + a.rdvConfirme + a.passerHumain)) / a.answered)
      : 0;
  return {
    synthese:
      `Sur la période ${ctx.periodLabel}, ${a.total} appels ont été passés. ` +
      `Le taux de décroché s'établit à ${pctDecroche}% et la qualification productive ` +
      `(RAPPEL + RDV + transferts humain) à ${pctProductif}% des décrochés. ` +
      `Le pipeline de rappels actifs à traiter compte ${ctx.callbacksDue} lignes échues.`,
    execMessages: [
      {
        tone: "good",
        heading: "Ce qui fonctionne",
        big: `${a.rdvConfirme + a.passerHumain}`,
        body: `${a.rdvConfirme} RDV confirmés et ${a.passerHumain} dossiers transférés à l'humain — la conversion productive est mesurable.`,
      },
      {
        tone: "warn",
        heading: "Le goulot",
        big: `${ctx.callbacksDue}`,
        body: `Rappels échus en attente de traitement. Sans cadence active, ils dégradent la conversion.`,
      },
      {
        tone: "info",
        heading: "Point d'attention",
        big: `${pctDecroche}%`,
        body: `Taux de décroché. Comparer aux fenêtres horaires les plus performantes pour réoptimiser le planning.`,
      },
    ],
    vigilance: [
      ...(ctx.overDialed > 0 ? [{
        tone: "warn" as const,
        heading: "Leads sur-appelés sans qualification",
        body: `${ctx.overDialed} contacts cumulent 8+ tentatives sans résultat. Risque de plainte et de signalement carrier.`,
        fix: "Bascule automatique en PAS INTERESSE après N tentatives.",
      }] : []),
      ...(a.withRecording < a.answered * 0.5 && a.answered > 5 ? [{
        tone: "info" as const,
        heading: "Audio manquant sur la majorité des appels",
        body: `${a.withRecording} enregistrements sur ${a.answered} décrochés. Coupe l'audit qualité et la revue d'écoute.`,
        fix: "Vérifier la conf SIP trunk Twilio (RecordingStatusCallback).",
      }] : []),
    ],
    methodNote:
      `Période ${ctx.periodLabel}. Compteurs lus en direct de la table calls (org_id). ` +
      `Les qualifications sont issues de calls.metadata.qualification écrites par l'agent ou auto-inférées en fin d'appel.`,
  };
}
