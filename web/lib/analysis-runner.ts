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
import {
  bucketForCall,
  normalizeQualification,
  QUAL_BUCKETS,
  type QualBucket,
} from "./qualification";

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

// Retell calls don't populate call_transcripts; their transcript lives in
// metadata (transcript_turns preferred, transcript_text fallback). Used so
// auto-qualification reads the real dialogue, not just the summary.
function metaTranscriptText(metadata: Record<string, unknown> | null | undefined): string {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const turns = m.transcript_turns;
  if (Array.isArray(turns) && turns.length) {
    return turns
      .map((t) => {
        const o = (t ?? {}) as { role?: unknown; content?: unknown };
        const who = o.role === "user" ? "customer" : "agent";
        const text = typeof o.content === "string" ? o.content : "";
        return text ? `${who}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return typeof m.transcript_text === "string" ? m.transcript_text.trim() : "";
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
  return "deepseek-v4-flash";
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

  // Look up the agent's declared language so the summary is in the right
  // language. Without this, DeepSeek (a Chinese model) regularly defaults
  // to Chinese for English transcripts. Falls back to mirroring the
  // transcript's own language when we can't resolve an agent.
  let agentLang: string | null = null;
  try {
    const { data: callRow } = await sb
      .from("calls")
      .select("agent_handle_id, agent_handles(ai_agent_id)")
      .eq("id", callId)
      .maybeSingle();
    const handles = (callRow as { agent_handles?: { ai_agent_id?: string | null } | { ai_agent_id?: string | null }[] } | null)?.agent_handles;
    const aiAgentId = Array.isArray(handles) ? handles[0]?.ai_agent_id : handles?.ai_agent_id;
    if (aiAgentId) {
      const { data: ag } = await sb
        .from("agents")
        .select("language")
        .eq("id", aiAgentId)
        .maybeSingle();
      agentLang = ((ag as { language?: string | null } | null)?.language ?? null);
    }
  } catch {
    /* fall back to mirror-transcript */
  }

  const langNames: Record<string, string> = {
    fr: "French", en: "English", es: "Spanish", de: "German",
    it: "Italian", pt: "Portuguese", nl: "Dutch",
  };
  const targetLang = agentLang ? (langNames[agentLang.toLowerCase()] ?? null) : null;
  const langDirective = targetLang
    ? `You MUST write the summary in ${targetLang}. Do not use any other language under any circumstances.`
    : "Write the summary in the SAME language as the transcript. Never switch languages.";

  const systemPrompt = [
    "You summarize phone-call transcripts in 3 to 5 sentences.",
    "Mention: reason for the call, key points raised, outcome / next step.",
    "No markdown. No headers. Plain prose only.",
    langDirective,
  ].join(" ");

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
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

// ── AI auto-qualification ───────────────────────────────────────────────────
// An answered call must always be classifiable. When the live AI agent didn't
// stamp a qualification (ambiguous / short / interrupted call), this reads the
// transcript post-hoc and assigns ONE of the 9 dashboard buckets. It writes to
// calls.metadata.qualification (the same field bucketForCall reads first) with
// a `qualification_source: "ai_auto"` provenance flag, and NEVER overrides a
// qualification that already resolves to a real bucket — it only fills the gap.

const QUALIFY_BUCKET_GUIDE: Record<Exclude<QualBucket, "autre">, string> = {
  rdv_confirme:
    "Un rendez-vous / une consultation a été pris ou confirmé pendant l'appel.",
  passer_humain:
    "Le contact a une question complexe ou demande explicitement un humain ; à escalader.",
  suivi_requis:
    "Le patient a été transféré à un agent spécialiste (Isabelle/Victoria) mais l'appel s'est terminé SANS confirmation de RDV — lead chaud à suivre par un humain.",
  rappel:
    "Le contact a demandé à être rappelé plus tard, OU l'échange est trop court / confus pour conclure (seulement bonjour, pas de vraie discussion). En cas de doute entre rappel et pas_interesse, choisis rappel : on rappellera pour clarifier.",
  pas_interesse:
    "Le contact a EXPLICITEMENT refusé, décliné ou dit qu'il n'est pas intéressé. Ne pas utiliser cette catégorie si le patient n'a pas formulé un refus clair — préfère rappel.",
  pas_de_reponse:
    "Personne n'a réellement échangé (décroché puis silence, raccrochage immédiat).",
  repondeur:
    "C'est un répondeur / messagerie vocale / machine.",
  faux_numero:
    "Mauvais numéro : la personne jointe n'est pas le contact recherché.",
  non_eligible:
    "Le contact ne remplit pas les critères d'éligibilité.",
  ne_pas_rappeler:
    "Le contact demande à ne plus jamais être rappelé (opt-out).",
};

export type QualifyStatus =
  | "qualified"
  | "skipped_existing"
  | "skipped_not_answered"
  | "no_evidence";

export interface QualifyResult {
  call_id: string;
  status: QualifyStatus;
  bucket?: QualBucket;
  confidence?: number;
  reason?: string;
}

interface QualifyCallRow {
  id: string;
  org_id: string;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
}

/** Validate the model's choice; fall back to escalation when it can't decide. */
function coerceBucket(raw: unknown): { bucket: Exclude<QualBucket, "autre">; coerced: boolean } {
  const keys = QUAL_BUCKETS.map((b) => b.key);
  if (typeof raw === "string") {
    const s = raw.trim();
    if ((keys as string[]).includes(s)) {
      return { bucket: s as Exclude<QualBucket, "autre">, coerced: false };
    }
    // Model may have returned a label or free text — run it through the same
    // normaliser the rest of the dashboard uses before giving up.
    const n = normalizeQualification(s);
    if (n !== "autre") return { bucket: n, coerced: false };
  }
  // Undecidable → hand it to a human rather than guessing wrong.
  return { bucket: "passer_humain", coerced: true };
}

// Agent-chain stage detection. Name-agnostic on purpose (must keep working
// after Retell is gone): the model reasons on the ROLE progression in the
// transcript — reception/qualification → eligibility → booking — using the
// known names only as hints. Only calls at least this long are even considered
// (a real transfer never happens in a few seconds), which bounds LLM spend.
const AGENT_STAGE_MIN_SECS = 60;
const AGENT_STAGE_GUIDE = [
  '"agent_stage" : entier 1, 2 ou 3 = jusqu\'où l\'appel est réellement allé dans la chaîne d\'agents.',
  "Repère métier (indices, pas une règle de noms) : Agent 1 = Charlotte (accueil + qualification), Agent 2 = Isabelle (vérification d'éligibilité), Agent 3 = Victoria (prise de rendez-vous).",
  "- 1 = traité uniquement par le 1er agent ; AUCUN transfert effectif vers une autre personne.",
  "- 2 = transféré ET réellement pris en charge par un 2e interlocuteur (rôle éligibilité / Isabelle).",
  "- 3 = transféré plus loin et pris en charge par un 3e interlocuteur (rôle prise de RDV / Victoria).",
  "Base-toi UNIQUEMENT sur le déroulé réel du transcript : un transfert annoncé mais sans suite reste à l'étape précédente. Si les noms diffèrent, raisonne sur le rôle (accueil → éligibilité → RDV).",
].join("\n");

export async function qualifyCall(
  callId: string,
  opts: { markNoEvidence?: boolean } = {},
): Promise<QualifyResult> {
  const sb = supabaseServer();
  const { data: callRow, error } = await sb
    .from("calls")
    .select("id, org_id, answered_at, duration_secs, disposition, summary, metadata")
    .eq("id", callId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!callRow) throw new Error("call_not_found");
  const call = callRow as QualifyCallRow;

  // Only answered calls are in scope — an unanswered call legitimately has no
  // human-side content to classify.
  if (!call.answered_at) return { call_id: callId, status: "skipped_not_answered" };

  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  const current = bucketForCall(call);
  // Wati 25/06 — an explicit / human-set qualification is AUTHORITATIVE: ai_auto
  // must never overwrite it, regardless of how its value normalizes. Without
  // this guard a manual reclassification (e.g. SUIVI REQUIS) got re-stamped by
  // the AI on every re-run (D Davies reverted 3×).
  const qSrc = typeof meta.qualification_source === "string" ? meta.qualification_source : "";
  // reached_specialist is authoritative — never overwrite it (set by Python agent or DB fix).
  // Also treat any call already confirmed at agent_stage >= 2 as explicitly SUIVI REQUIS
  // so a late LLM re-run cannot downgrade it to "rappel" or anything else.
  const alreadyAtSpecialist =
    qSrc === "reached_specialist" ||
    (typeof meta.agent_stage === "number" && meta.agent_stage >= 2 &&
     current !== "autre" && current !== "rdv_confirme");
  const isExplicitQual =
    alreadyAtSpecialist ||
    (!!meta.qualification && !!qSrc && qSrc !== "ai_auto" && !qSrc.startsWith("auto_inferred"));
  // We do two jobs in one LLM pass: (a) qualify the call IF it has no real
  // qualification yet, and (b) detect the agent-chain stage (1/2/3) IF it's a
  // long-enough call missing one. Either job alone is enough to run the pass.
  // Also correct auto_inferred "passer_humain" when we have ground-truth evidence
  // (handoff event) that the lead reached a specialist — those should be SUIVI REQUIS.
  const needQualCorrection =
    current === "passer_humain" && qSrc === "auto_inferred";
  const needQual = (current === "autre" || needQualCorrection) && !isExplicitQual;
  const needStage = meta.agent_stage == null && (call.duration_secs ?? 0) >= AGENT_STAGE_MIN_SECS;
  if (!needQual && !needStage) {
    return { call_id: callId, status: "skipped_existing", bucket: current };
  }

  // Read whatever we have: native transcript preferred, then the Retell
  // transcript cached in metadata, then the summary as a last resort.
  const transcript = await fetchTranscriptText(callId);
  const evidence = transcript.trim() || metaTranscriptText(call.metadata) || (call.summary?.trim() ?? "");
  if (!evidence) {
    // Nothing to analyse YET (no transcript, no summary). Only the backfill
    // drain (markNoEvidence) stamps a terminal marker so an old, evidence-less
    // call stops being a candidate forever. Real-time callers (call-end hooks)
    // must NOT mark it — the transcript/summary may still be landing, and a
    // premature marker would block qualification once it arrives.
    if (opts.markNoEvidence) {
      const merged: Record<string, unknown> = { ...meta, analysis_skipped: "no_evidence" };
      if (meta.agent_stage == null) merged.agent_stage = 1;
      await sb.from("calls").update({ metadata: merged }).eq("id", callId);
    }
    return { call_id: callId, status: "no_evidence" };
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY missing");

  const guide = (Object.entries(QUALIFY_BUCKET_GUIDE) as [string, string][])
    .map(([k, d]) => `- "${k}": ${d}`)
    .join("\n");
  const schema = {
    qualification: QUAL_BUCKETS.map((b) => b.key),
    confidence: "number 0..1",
    reason: "string (max 160 chars, in French)",
    agent_stage: "1 | 2 | 3",
  };
  const system = [
    "Tu analyses un appel téléphonique décroché : tu le classes en EXACTEMENT une catégorie ET tu détermines jusqu'où il est allé dans la chaîne d'agents.",
    "Réponds UNIQUEMENT en JSON valide conforme au schéma — aucune prose.",
    "Choisis la catégorie la plus probable même si l'appel est court ou ambigu :",
    "un appel décroché doit toujours être classé.",
  ].join(" ");
  const userContent = [
    `Catégories autorisées (champ "qualification") :\n${guide}`,
    "",
    AGENT_STAGE_GUIDE,
    "",
    `Schéma JSON à respecter : ${JSON.stringify(schema)}`,
    "",
    "Transcript de l'appel :",
    evidence.slice(0, 12000),
  ].join("\n");

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
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
  };
  let parsed: { qualification?: unknown; confidence?: unknown; reason?: unknown; agent_stage?: unknown } = {};
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } catch {
    /* coerceBucket handles the empty/garbage case below */
  }
  const { bucket, coerced } = coerceBucket(parsed.qualification);
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;
  const reason =
    typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : null;
  const stageNum = Number(parsed.agent_stage);
  const agentStage = Number.isFinite(stageNum) ? Math.min(3, Math.max(1, Math.round(stageNum))) : 1;

  // Ground truth: did the call actually hand off to an internal specialist
  // (agent 2/3)? The LLM's agent_stage under-rates a handoff the patient
  // dropped on (D Davies hung up on Isabelle's greeting → LLM scored stage 1),
  // so we ALSO check the real handoff_initiated event the worker writes.
  let handedOffToSpecialist = false;
  try {
    const { data: hoEvents } = await sb
      .from("call_events")
      .select("kind")
      .eq("call_id", callId)
      .eq("kind", "handoff_initiated")
      .limit(1);
    handedOffToSpecialist = !!hoEvents && hoEvents.length > 0;
  } catch {
    /* best-effort — fall back to the LLM's agent_stage */
  }

  // Wati 25/06 — deterministic alignment with the worker's handoff→SUIVI REQUIS
  // rule (agent/db_writes.auto_qualify_call): a call that REACHED agent 2/3 (a
  // specialist) but didn't book is SUIVI REQUIS, not "à passer à l'humain".
  // Without this, the DeepSeek classifier (and its undecidable→passer_humain
  // fallback at coerceBucket) keeps flooding the human desk with warm leads
  // that merely reached Isabelle/Victoria without confirming an appointment.
  let finalBucket: Exclude<QualBucket, "autre"> = bucket;
  if ((agentStage >= 2 || handedOffToSpecialist) && finalBucket !== "rdv_confirme") {
    finalBucket = "suivi_requis";
  }

  const mergedMeta: Record<string, unknown> = { ...meta };
  // (a) Qualification — when the call had none, OR when correcting auto_inferred
  // passer_humain calls that provably reached a specialist (ground-truth handoff event).
  const shouldWriteQual =
    needQual && (current !== "passer_humain" || handedOffToSpecialist);
  if (shouldWriteQual) {
    mergedMeta.qualification = finalBucket;
    mergedMeta.qualification_source = "ai_auto";
    mergedMeta.qualification_ai = {
      confidence: coerced ? 0 : confidence,
      reason: finalBucket !== bucket
        ? "A atteint un agent spécialiste sans confirmation de RDV — suivi requis."
        : coerced ? "Indécidable par l'IA — escaladé à un humain." : reason,
      model: "deepseek-v4-flash",
      at: new Date().toISOString(),
    };
  }
  // (b) Agent-chain stage — always stamped (we have it from this pass).
  mergedMeta.agent_stage = agentStage;
  mergedMeta.agent_stage_source = "ai_auto";

  const { error: upErr } = await sb
    .from("calls")
    .update({ metadata: mergedMeta })
    .eq("id", callId);
  if (upErr) throw new Error(upErr.message);

  // "qualified" status only when we actually wrote a qualification, so the
  // backlog-drain's progress check stays meaningful.
  return {
    call_id: callId,
    status: shouldWriteQual ? "qualified" : "skipped_existing",
    bucket: needQual ? finalBucket : current,
    confidence: needQual ? (coerced ? 0 : confidence ?? undefined) : undefined,
    reason: needQual && typeof reason === "string" ? reason : undefined,
  };
}
