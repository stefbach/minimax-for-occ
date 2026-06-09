import { buildSystemPrompt, buildUserMessage } from "./prompts";
import type { InsightsCallInput, InsightsResult } from "./types";

// Generates the strategic insights report from a period's calls using DeepSeek
// in json_object mode. One LLM pass over the call summaries → structured JSON.

const MAX_CALLS_TO_LLM = 400; // safety cap to keep the request within limits
const DEEPSEEK_CHAT_URL =
  (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "") +
  "/chat/completions";
const INSIGHTS_MODEL = process.env.DEEPSEEK_INSIGHTS_MODEL ?? "deepseek-chat";

interface GenerateArgs {
  calls: InsightsCallInput[];
  periodLabel: string;
}

// Keep all confirmed RDV (precious signal) + PAS INTERESSE up to 60, then fill.
function selectCalls(calls: InsightsCallInput[]): InsightsCallInput[] {
  if (calls.length <= MAX_CALLS_TO_LLM) return calls;
  const rdv = calls.filter((c) => c.qualification_effective === "RDV CONFIRME");
  const lost = calls.filter((c) => c.qualification_effective === "PAS INTERESSE");
  const rest = calls.filter(
    (c) => c.qualification_effective !== "RDV CONFIRME" && c.qualification_effective !== "PAS INTERESSE",
  );
  const budget = MAX_CALLS_TO_LLM - rdv.length - Math.min(lost.length, 60);
  return [...rdv, ...lost.slice(0, 60), ...rest.slice(0, Math.max(budget, 0))];
}

function aggregateStats(calls: InsightsCallInput[]) {
  const s = {
    total: calls.length,
    rdv: 0, a_passer_a_humain: 0, rappel: 0, pas_interesse: 0, pas_de_reponse: 0,
    repondeur: 0, faux_numero: 0, non_eligible: 0, ne_pas_rappeler: 0,
    answered: 0, avg_duration_seconds: 0,
  };
  let duration = 0;
  for (const c of calls) {
    switch (c.qualification_effective) {
      case "RDV CONFIRME": s.rdv++; break;
      case "À PASSER À L'HUMAIN": s.a_passer_a_humain++; break;
      case "RAPPEL": s.rappel++; break;
      case "PAS INTERESSE": s.pas_interesse++; break;
      case "PAS DE REPONSE": s.pas_de_reponse++; break;
      case "REPONDEUR": s.repondeur++; break;
      case "FAUX NUMERO": s.faux_numero++; break;
      case "NON ELIGIBLE": s.non_eligible++; break;
      case "NE PAS RAPPELER": s.ne_pas_rappeler++; break;
    }
    if (c.answered) s.answered++;
    duration += c.duration_seconds;
  }
  s.avg_duration_seconds = s.total > 0 ? duration / s.total : 0;
  return s;
}

// The model can omit fields even when required; coerce everything to a safe
// shape so the UI never crashes on a partial response.
function normalizeInsights(raw: unknown): Omit<InsightsResult, "meta"> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pulse = (r.pulse ?? {}) as Record<string, unknown>;
  const trends = (r.trends ?? {}) as Record<string, unknown>;
  const audit = (r.script_audit ?? {}) as Record<string, unknown>;
  const sentiment = (r.sentiment ?? {}) as Record<string, unknown>;
  const distribution = (sentiment.distribution ?? {}) as Record<string, unknown>;

  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const num = (v: unknown, f = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const str = (v: unknown, f = ""): string => (typeof v === "string" ? v : f);

  return {
    pulse: {
      summary: str(pulse.summary, "Analyse en cours…"),
      highlights: arr<Record<string, unknown>>(pulse.highlights).map((h) => ({
        label: str(h.label), value: str(h.value),
      })),
    },
    strategic_alerts: arr<Record<string, unknown>>(r.strategic_alerts).map((a) => ({
      severity: a.severity === "high" || a.severity === "medium" || a.severity === "low" ? (a.severity as "high" | "medium" | "low") : "low",
      message: str(a.message),
      evidence_count: num(a.evidence_count),
    })),
    objections: arr<Record<string, unknown>>(r.objections).map((o) => ({
      label: str(o.label),
      count: num(o.count),
      percent: num(o.percent),
      example_call_ids: arr<string>(o.example_call_ids).filter((x) => typeof x === "string"),
      counter_argument: str(o.counter_argument),
    })),
    trends: {
      emerging_keywords: arr<Record<string, unknown>>(trends.emerging_keywords).map((k) => ({
        keyword: str(k.keyword), count: num(k.count), note: str(k.note),
      })),
      weak_signals: arr<string>(trends.weak_signals).filter((x) => typeof x === "string"),
    },
    script_audit: {
      common_hangup_topics: arr<Record<string, unknown>>(audit.common_hangup_topics).map((t) => ({
        topic: str(t.topic),
        count: num(t.count),
        example_call_ids: arr<string>(t.example_call_ids).filter((x) => typeof x === "string"),
      })),
      converted_call_patterns: arr<Record<string, unknown>>(audit.converted_call_patterns).map((p) => ({
        phrase_or_theme: str(p.phrase_or_theme),
        frequency_in_won: num(p.frequency_in_won),
        frequency_in_lost: num(p.frequency_in_lost),
      })),
    },
    sentiment: {
      average_score: num(sentiment.average_score),
      distribution: {
        positive: num(distribution.positive),
        neutral: num(distribution.neutral),
        negative: num(distribution.negative),
      },
      hot_leads: arr<Record<string, unknown>>(sentiment.hot_leads).map((h) => ({
        call_id: str(h.call_id), reason: str(h.reason),
      })),
    },
    optimization_hypotheses: arr<Record<string, unknown>>(r.optimization_hypotheses).map((h) => ({
      observation: str(h.observation), test_to_run: str(h.test_to_run),
    })),
  };
}

export async function generateInsights({ calls, periodLabel }: GenerateArgs): Promise<InsightsResult> {
  const startedAt = Date.now();
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY n'est pas configurée. Ajoute-la dans l'environnement Vercel puis redéploie.");
  }

  const callsWithSummary = calls.filter((c) => typeof c.summary === "string" && c.summary.trim().length > 10);
  const selected = selectCalls(callsWithSummary);
  const stats = aggregateStats(calls);

  const compact = selected.map((c) => ({
    id: c.call_id,
    qualification: c.qualification_effective, // dashboard view — count from this
    qualification_crm: c.qualification ?? "UNKNOWN",
    duration_s: c.duration_seconds,
    hour: c.hour_of_day,
    dow: c.day_of_week,
    disconnect: c.disconnection_reason ?? null,
    attempt: c.attempt_number,
    answered: c.answered,
    summary: (c.summary ?? "").slice(0, 600),
  }));

  const userMessage = buildUserMessage({
    periodLabel,
    callsAnalysed: calls.length,
    callsWithSummary: callsWithSummary.length,
    stats,
    callsJson: JSON.stringify(compact),
  });

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: INSIGHTS_MODEL,
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("La réponse du modèle n'était pas un JSON valide. Réessaie.");
  }

  const insights = normalizeInsights(parsed);
  return {
    ...insights,
    meta: {
      generated_at: new Date().toISOString(),
      calls_analysed: calls.length,
      calls_with_summary: callsWithSummary.length,
      period_label: periodLabel,
      model: INSIGHTS_MODEL,
      cached: false,
      elapsed_ms: Date.now() - startedAt,
    },
  };
}
