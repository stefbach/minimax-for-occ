import type { InsightsCallInput } from "./types";

// Tools the Q&A assistant can call to dig into the period's calls (DeepSeek /
// OpenAI function-calling format). Counting uses qualification_effective, the
// same FR labels the dashboard shows.

const QUALIFICATIONS = [
  "RDV CONFIRME",
  "À PASSER À L'HUMAIN",
  "RAPPEL",
  "PAS INTERESSE",
  "PAS DE REPONSE",
  "REPONDEUR",
  "FAUX NUMERO",
  "NON ELIGIBLE",
  "NE PAS RAPPELER",
] as const;

export type OpenAiTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const CHAT_TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "search_calls",
      description:
        "Cherche dans les appels filtrés. Combine les filtres pour cibler (ex. PAS INTERESSE + mot-clé 'coût'). Renvoie un extrait du résumé de chaque appel correspondant.",
      parameters: {
        type: "object",
        properties: {
          qualification: { type: "string", enum: [...QUALIFICATIONS], description: "Filtrer par qualification exacte" },
          keyword: { type: "string", description: "Mot-clé (insensible à la casse) à chercher dans le résumé. Ex. 'coût', 'mari', 'BMI'." },
          min_duration_seconds: { type: "number" },
          max_duration_seconds: { type: "number" },
          answered_only: { type: "boolean", description: "True = uniquement les appels avec réponse réelle." },
          limit: { type: "number", description: "Nombre max de résultats (défaut 15, max 50)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_call_detail",
      description: "Récupère le résumé complet d'un appel précis (jusqu'à 2000 caractères) à partir de son call_id.",
      parameters: {
        type: "object",
        required: ["call_id"],
        properties: { call_id: { type: "string", description: "L'identifiant exact de l'appel" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_aggregated_stats",
      description: "Renvoie des compteurs agrégés sur les appels filtrés selon une dimension. Utile pour 'combien d'appels par X'.",
      parameters: {
        type: "object",
        required: ["group_by"],
        properties: {
          group_by: { type: "string", enum: ["qualification", "hour_of_day", "day_of_week", "disconnect_reason"] },
        },
      },
    },
  },
];

interface SearchInput {
  qualification?: string;
  keyword?: string;
  min_duration_seconds?: number;
  max_duration_seconds?: number;
  answered_only?: boolean;
  limit?: number;
}

export function executeChatTool(name: string, rawInput: unknown, calls: InsightsCallInput[]): string {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  if (name === "search_calls") {
    const i = input as SearchInput;
    const limit = Math.min(typeof i.limit === "number" ? i.limit : 15, 50);
    const kw = i.keyword?.toLowerCase();
    const filtered = calls.filter((c) => {
      if (i.qualification && c.qualification_effective !== i.qualification) return false;
      if (i.answered_only && !c.answered) return false;
      if (typeof i.min_duration_seconds === "number" && c.duration_seconds < i.min_duration_seconds) return false;
      if (typeof i.max_duration_seconds === "number" && c.duration_seconds > i.max_duration_seconds) return false;
      if (kw && !(c.summary ?? "").toLowerCase().includes(kw)) return false;
      return true;
    });
    const slice = filtered.slice(0, limit).map((c) => ({
      call_id: c.call_id,
      qualification: c.qualification_effective,
      duration_s: c.duration_seconds,
      hour: c.hour_of_day,
      summary_excerpt: (c.summary ?? "").slice(0, 250),
    }));
    return JSON.stringify({ total_matches: filtered.length, returned: slice.length, results: slice });
  }

  if (name === "get_call_detail") {
    const callId = typeof input.call_id === "string" ? input.call_id : "";
    const call = calls.find((c) => c.call_id === callId);
    if (!call) return JSON.stringify({ error: `Aucun appel trouvé avec call_id=${callId}` });
    return JSON.stringify({
      call_id: call.call_id,
      qualification: call.qualification_effective,
      duration_seconds: call.duration_seconds,
      hour_of_day: call.hour_of_day,
      day_of_week: call.day_of_week,
      disconnect_reason: call.disconnection_reason,
      answered: call.answered,
      summary: (call.summary ?? "").slice(0, 2000),
    });
  }

  if (name === "get_aggregated_stats") {
    const groupBy = String(input.group_by ?? "qualification");
    const buckets: Record<string, number> = {};
    for (const c of calls) {
      let k: string;
      switch (groupBy) {
        case "hour_of_day": k = String(c.hour_of_day); break;
        case "day_of_week": k = String(c.day_of_week); break;
        case "disconnect_reason": k = c.disconnection_reason ?? "unknown"; break;
        default: k = c.qualification_effective;
      }
      buckets[k] = (buckets[k] ?? 0) + 1;
    }
    return JSON.stringify({ group_by: groupBy, total_calls: calls.length, counts: buckets });
  }

  return JSON.stringify({ error: `Outil inconnu: ${name}` });
}
