/**
 * Run LLM analysis policies over a call transcript.
 *
 * For each enabled policy in the org (and matching scope), send the
 * configured prompt + transcript to the LLM, validate that the parsed
 * JSON conforms to the policy's `output_schema`, persist the result in
 * `call_analyses`, then evaluate every enabled `alert_rule` bound to
 * that policy and INSERT matching rows into `alerts`.
 *
 * Errors per-policy are isolated — one failure doesn't sink the batch.
 */

import { supabaseServer } from "./supabase";
import { evaluateRule, type AlertRuleLike } from "./alerts-evaluator";

interface AnalysisPolicy {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  prompt: string;
  output_schema: Record<string, unknown>;
  scope: string;
  scope_id: string | null;
  enabled: boolean;
  model: string | null;
}

interface CallContext {
  id: string;
  org_id: string;
  queue_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RunAnalysisOptions {
  /** Override the transcript text. If omitted, we fetch from call_transcripts. */
  transcriptText?: string;
  /** Limit to a single policy id (manual trigger). */
  policyId?: string;
}

const DEEPSEEK_CHAT_URL =
  (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "") +
  "/chat/completions";

function policyMatchesCall(p: AnalysisPolicy, call: CallContext): boolean {
  if (p.scope === "all" || !p.scope_id) return true;
  if (p.scope === "queue") return p.scope_id === call.queue_id;
  if (p.scope === "campaign") {
    const cid = (call.metadata?.["campaign_id"] ?? null) as string | null;
    return p.scope_id === cid;
  }
  return true;
}

async function fetchTranscriptText(callId: string): Promise<string> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("call_transcripts")
    .select("speaker, text, started_at, seq")
    .eq("call_id", callId)
    .order("seq", { ascending: true });
  const rows = (data ?? []) as Array<{ speaker: string; text: string }>;
  return rows.map((r) => `${r.speaker}: ${r.text}`).join("\n");
}

interface LlmCallResult {
  parsed: unknown;
  tokensInput: number | null;
  tokensOutput: number | null;
}

/** Map legacy OpenAI model names stored in analysis_policies rows to DeepSeek equivalents. */
function resolveAnalysisModel(stored: string | null): string {
  const m = stored ?? "";
  if (m.startsWith("deepseek-")) return m;
  if (m === "o1" || m === "o1-mini" || m === "o3-mini") return "deepseek-reasoner";
  return "deepseek-chat";
}

async function callOpenAi(
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  transcript: string,
): Promise<LlmCallResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY missing");

  const system = [
    "You analyse a phone call transcript and return structured JSON.",
    "Respond ONLY with valid JSON matching the user-provided schema — no prose.",
    "If a field is unknown, use null. Never invent data.",
  ].join(" ");

  const userContent = [
    `Schema (the JSON you return MUST conform to it): ${JSON.stringify(schema)}`,
    `Instruction: ${prompt}`,
    "",
    "Transcript:",
    transcript || "(empty transcript)",
  ].join("\n");

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { _raw: content, _parse_error: true };
  }
  return {
    parsed,
    tokensInput: data.usage?.prompt_tokens ?? null,
    tokensOutput: data.usage?.completion_tokens ?? null,
  };
}

/** Rough cost estimate in *cents* (deepseek-chat: input $0.014/M cache-hit, output $0.28/M). */
function estimateCostCents(model: string, ti: number | null, to: number | null): number | null {
  if (ti == null && to == null) return null;
  const lower = (model ?? "").toLowerCase();
  // deepseek-reasoner (R1) is priced differently
  let inPerM = lower.includes("reasoner") ? 0.55 : 0.27;
  let outPerM = lower.includes("reasoner") ? 2.19 : 1.10;
  const dollars = ((ti ?? 0) / 1_000_000) * inPerM + ((to ?? 0) / 1_000_000) * outPerM;
  return Math.max(0, Math.round(dollars * 100));
}

export interface AnalysisRunResult {
  policy_id: string;
  ok: boolean;
  error?: string;
  alerts_created?: number;
}

export async function runAnalysisPolicies(
  callId: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisRunResult[]> {
  const sb = supabaseServer();

  const { data: callRow, error: callErr } = await sb
    .from("calls")
    .select("id, org_id, queue_id, metadata")
    .eq("id", callId)
    .maybeSingle();
  if (callErr) throw new Error(callErr.message);
  if (!callRow) throw new Error("call_not_found");
  const call = callRow as CallContext;

  // Fetch eligible policies for the org.
  let policiesQuery = sb
    .from("analysis_policies")
    .select("id, org_id, name, description, prompt, output_schema, scope, scope_id, enabled, model")
    .eq("org_id", call.org_id)
    .eq("enabled", true);
  if (opts.policyId) policiesQuery = policiesQuery.eq("id", opts.policyId);

  const { data: polData, error: polErr } = await policiesQuery;
  if (polErr) throw new Error(polErr.message);
  const policies = ((polData ?? []) as AnalysisPolicy[]).filter((p) =>
    policyMatchesCall(p, call),
  );
  if (policies.length === 0) return [];

  const transcriptText = opts.transcriptText ?? (await fetchTranscriptText(callId));

  // Pull all enabled alert rules for this org once.
  const { data: rulesData } = await sb
    .from("alert_rules")
    .select("id, org_id, name, policy_id, condition, severity, enabled")
    .eq("org_id", call.org_id)
    .eq("enabled", true);
  const allRules = (rulesData ?? []) as AlertRuleLike[];

  const results: AnalysisRunResult[] = [];
  for (const policy of policies) {
    try {
      const resolvedModel = resolveAnalysisModel(policy.model);
      const llm = await callOpenAi(
        resolvedModel,
        policy.prompt,
        policy.output_schema ?? {},
        transcriptText,
      );

      const costCents = estimateCostCents(
        resolvedModel,
        llm.tokensInput,
        llm.tokensOutput,
      );

      // Upsert by (call_id, policy_id).
      const { error: upErr } = await sb
        .from("call_analyses")
        .upsert(
          {
            call_id: callId,
            policy_id: policy.id,
            result: llm.parsed as object,
            tokens_input: llm.tokensInput,
            tokens_output: llm.tokensOutput,
            cost_cents: costCents,
          },
          { onConflict: "call_id,policy_id" },
        );
      if (upErr) throw new Error(upErr.message);

      // Evaluate alert rules for this policy.
      const rulesForPolicy = allRules.filter((r) => r.policy_id === policy.id);
      let alertsCreated = 0;
      for (const rule of rulesForPolicy) {
        const ev = evaluateRule(rule, llm.parsed);
        if (!ev.matched) continue;
        const { error: alErr } = await sb.from("alerts").insert({
          org_id: call.org_id,
          rule_id: rule.id,
          call_id: callId,
          severity: rule.severity ?? "info",
          message: `${rule.name} — ${policy.name}`,
          payload: {
            actual: ev.actual,
            condition: rule.condition,
            policy_id: policy.id,
            policy_name: policy.name,
          },
        });
        if (!alErr) alertsCreated += 1;
      }
      results.push({ policy_id: policy.id, ok: true, alerts_created: alertsCreated });
    } catch (e) {
      results.push({
        policy_id: policy.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/** Generate a short LLM summary of the call and store it in calls.summary. */
export async function generateCallSummary(callId: string): Promise<string> {
  const sb = supabaseServer();
  const transcript = await fetchTranscriptText(callId);
  if (!transcript.trim()) {
    await sb
      .from("calls")
      .update({ summary: "(transcript indisponible)", summary_generated_at: new Date().toISOString() })
      .eq("id", callId);
    return "(transcript indisponible)";
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY missing");

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Tu résumes des appels téléphoniques en 3 à 5 phrases. Mentionne : raison de l'appel, points clés, issue/prochaine étape. Pas de markdown.",
        },
        { role: "user", content: `Transcript:\n${transcript}` },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const summary = (data.choices?.[0]?.message?.content ?? "").trim();
  await sb
    .from("calls")
    .update({ summary, summary_generated_at: new Date().toISOString() })
    .eq("id", callId);
  return summary;
}
