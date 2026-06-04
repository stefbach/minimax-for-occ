/**
 * Sentinel Wave 1 — preflight hard rules for campaigns.
 *
 * Pure deterministic checks fired at TWO points:
 *  1. Wizard step 3 "Créer" recap (against the in-memory draft, no DB).
 *  2. POST /api/campaigns/:id/start (against the persisted row, server-side).
 *
 * Wave 2+ (LLM, runtime, post-call) live elsewhere; this file is rule-engine
 * only. No DB queries: callers resolve agent + phone-number rows themselves
 * and pass them in as `agent` and `phoneNumber` snapshots.
 *
 * See docs/feasibility/sentinel-agents.md (Wave 1, rules #1-13 / #17-18).
 */

export type PreflightSeverity = "blocker" | "warning" | "info";

export interface PreflightCheck {
  id: string;
  label: string;
  severity: PreflightSeverity;
  passed: boolean;
  /** One-sentence factual detail — what was observed. */
  detail: string;
  /** One-sentence actionable remediation hint. */
  remediation: string;
}

/** Schedule shape stored on `campaigns.schedule` (jsonb). */
export interface PreflightSchedule {
  days?: number[] | null;
  hours?: {
    start?: string | null;
    end?: string | null;
    ranges?: Array<{ start: string; end: string }> | null;
  } | null;
}

/** Minimal agent snapshot — fields read from `agents` via the chosen handle. */
export interface PreflightAgent {
  /** `agents.prompt` (preferred) or `agents.instructions`, whichever exists. */
  prompt?: string | null;
  /** Alias accepted because the live schema uses `system_prompt`. */
  system_prompt?: string | null;
  /** Some tenants stored the prompt as `instructions`. */
  instructions?: string | null;
  tts_voice_id?: string | null;
}

/** Minimal phone-number snapshot — fields read from `phone_numbers`. */
export interface PreflightPhoneNumber {
  active?: boolean | null;
  e164?: string | null;
}

export interface PreflightInput {
  name?: string | null;
  agent_handle_id?: string | null;
  agent_team_id?: string | null;
  phone_number_id?: string | null;
  caller_id_e164?: string | null;
  data_table_id?: string | null;
  contact_list_id?: string | null;
  csv_text?: string | null;
  targets?: Array<{ e164: string; name?: string | null }> | null;
  schedule?: PreflightSchedule | null;
  max_concurrency?: number | null;
  max_attempts?: number | null;
  retry_delay_min?: number | null;
  amd_enabled?: boolean | null;
  engine?: Record<string, unknown> | null;
  org_id?: string | null;

  /**
   * Resolved agent row referenced by `agent_handle_id`. Callers (wizard +
   * server) fetch this themselves — the rule engine stays DB-free.
   */
  agent?: PreflightAgent | null;
  /** Resolved phone-number row referenced by `phone_number_id`. */
  phoneNumber?: PreflightPhoneNumber | null;
}

export interface PreflightResult {
  checks: PreflightCheck[];
}

/** Free-tier ceiling imposed by upstream STT (AssemblyAI). */
const PLAN_CONCURRENCY_LIMIT = Number(
  process.env.NEXT_PUBLIC_STT_CONCURRENT_LIMIT ?? 5,
);

const E164 = /^\+[1-9][0-9]{6,14}$/;

function isE164(s: string | null | undefined): s is string {
  return typeof s === "string" && E164.test(s.trim());
}

function agentPrompt(a: PreflightAgent | null | undefined): string {
  if (!a) return "";
  return (a.prompt ?? a.system_prompt ?? a.instructions ?? "").trim();
}

/**
 * Run Wave 1 hard-rule preflight against an in-memory or persisted campaign
 * draft. Returns a result for every check (passed or not); the caller groups
 * by severity for display.
 */
export function preflightCampaign(input: PreflightInput): PreflightResult {
  const checks: PreflightCheck[] = [];

  // ── 1. agent_selected ───────────────────────────────────────────────
  const hasAgentRef =
    Boolean(input.agent_handle_id) || Boolean(input.agent_team_id);
  checks.push({
    id: "agent_selected",
    label: "Un agent ou une équipe est sélectionné(e)",
    severity: "blocker",
    passed: hasAgentRef,
    detail: hasAgentRef
      ? "Un agent (ou une équipe) est attaché à la campagne."
      : "Aucun agent ni équipe n'est attaché à la campagne.",
    remediation:
      "Étape 1 du wizard : choisis un agent IA, ou une team multi-agents.",
  });

  // ── 2. agent_has_prompt ─────────────────────────────────────────────
  // Only check when an agent reference exists — otherwise it's redundant with
  // #1. The check still reports `passed=false` so the UI shows the issue.
  const prompt = agentPrompt(input.agent);
  const promptOk = hasAgentRef ? prompt.length > 0 : false;
  checks.push({
    id: "agent_has_prompt",
    label: "L'agent a un prompt (instructions)",
    severity: "blocker",
    passed: promptOk,
    detail: promptOk
      ? "L'agent dispose d'instructions de conversation."
      : hasAgentRef
        ? "L'agent référencé n'a pas de prompt/instructions configuré."
        : "Impossible de vérifier le prompt tant qu'aucun agent n'est sélectionné.",
    remediation:
      "Ouvre l'agent, ajoute une instruction (page Agents).",
  });

  // ── 3. agent_has_voice ──────────────────────────────────────────────
  const voiceOk = hasAgentRef
    ? Boolean(input.agent?.tts_voice_id && String(input.agent.tts_voice_id).trim())
    : false;
  checks.push({
    id: "agent_has_voice",
    label: "L'agent a une voix TTS",
    severity: "blocker",
    passed: voiceOk,
    detail: voiceOk
      ? "L'agent a une voix TTS associée."
      : hasAgentRef
        ? "L'agent référencé n'a pas de `tts_voice_id`."
        : "Impossible de vérifier la voix tant qu'aucun agent n'est sélectionné.",
    remediation:
      "Sélectionne ou clone une voix sur la fiche agent (page Agents → Voix).",
  });

  // ── 4. phone_number_selected ────────────────────────────────────────
  const callerOverride = (input.caller_id_e164 ?? "").trim();
  const hasNumberRef =
    Boolean(input.phone_number_id) ||
    (callerOverride.length > 0 && isE164(callerOverride));
  checks.push({
    id: "phone_number_selected",
    label: "Un numéro émetteur est choisi",
    severity: "blocker",
    passed: hasNumberRef,
    detail: hasNumberRef
      ? "Un numéro Twilio ou un caller-id E.164 est défini."
      : callerOverride.length > 0
        ? `Le caller-id « ${callerOverride} » n'est pas un E.164 valide.`
        : "Aucun numéro émetteur ni caller-id E.164 n'est défini.",
    remediation:
      "Étape 1 du wizard : choisis un numéro Twilio, ou saisis un caller-id au format +33…",
  });

  // ── 5. phone_number_active ──────────────────────────────────────────
  // When the user picked a phone_number_id we require the row to be active.
  // When they only use a caller_id_e164 override, we trust them (no row to
  // check) and mark the check as passed.
  let activeOk: boolean;
  let activeDetail: string;
  if (input.phone_number_id) {
    activeOk = Boolean(input.phoneNumber?.active);
    activeDetail = activeOk
      ? `Le numéro ${input.phoneNumber?.e164 ?? ""} est actif.`
      : `Le numéro ${input.phoneNumber?.e164 ?? "sélectionné"} est désactivé (active=false).`;
  } else if (callerOverride && isE164(callerOverride)) {
    activeOk = true;
    activeDetail = "Caller-id E.164 fourni — pas de ligne `phone_numbers` à vérifier.";
  } else {
    activeOk = false;
    activeDetail = "Pas de numéro à vérifier (cf. blocage précédent).";
  }
  checks.push({
    id: "phone_number_active",
    label: "Le numéro émetteur est actif",
    severity: "blocker",
    passed: activeOk,
    detail: activeDetail,
    remediation:
      "Réactive le numéro depuis la page Numéros, ou choisis-en un autre.",
  });

  // ── 6. target_source_set ────────────────────────────────────────────
  const csvText = (input.csv_text ?? "").trim();
  const targetCount = Array.isArray(input.targets) ? input.targets.length : 0;
  const hasSource =
    Boolean(input.data_table_id) ||
    Boolean(input.contact_list_id) ||
    csvText.length > 0 ||
    targetCount > 0;
  checks.push({
    id: "target_source_set",
    label: "Une source de cibles est définie",
    severity: "blocker",
    passed: hasSource,
    detail: hasSource
      ? "Une table de contacts, liste, CSV ou liste explicite est fournie."
      : "Aucune source de cibles (table, liste, CSV, contacts) n'est configurée.",
    remediation:
      "Étape 2 du wizard : choisis une table de contacts, une liste, ou colle un CSV.",
  });

  // ── 7. schedule_has_days ────────────────────────────────────────────
  const days = Array.isArray(input.schedule?.days) ? input.schedule!.days! : [];
  const daysOk = days.length >= 1;
  checks.push({
    id: "schedule_has_days",
    label: "Au moins un jour autorisé",
    severity: "blocker",
    passed: daysOk,
    detail: daysOk
      ? `${days.length} jour(s) autorisé(s).`
      : "Aucun jour n'est coché dans le planning.",
    remediation:
      "Étape 3 du wizard : coche au moins un jour de la semaine.",
  });

  // ── 8. schedule_has_hours ───────────────────────────────────────────
  const hours = input.schedule?.hours ?? null;
  const ranges = Array.isArray(hours?.ranges) ? hours!.ranges! : [];
  const startEndOk = Boolean(
    hours?.start && hours?.end && String(hours.start).length > 0 && String(hours.end).length > 0,
  );
  const hoursOk = startEndOk || ranges.length >= 1;
  checks.push({
    id: "schedule_has_hours",
    label: "Une plage horaire est définie",
    severity: "blocker",
    passed: hoursOk,
    detail: hoursOk
      ? ranges.length >= 1
        ? `${ranges.length} plage(s) horaire(s) configurée(s).`
        : `Plage ${hours?.start}–${hours?.end}.`
      : "Aucune plage horaire (start/end ou ranges) n'est définie.",
    remediation:
      "Étape 3 du wizard : ajoute au moins une plage horaire.",
  });

  // ── 9. concurrency_within_plan (warning) ────────────────────────────
  const conc = Number(input.max_concurrency ?? 0);
  const concOk = conc > 0 && conc <= PLAN_CONCURRENCY_LIMIT;
  checks.push({
    id: "concurrency_within_plan",
    label: `Concurrence ≤ limite du plan (${PLAN_CONCURRENCY_LIMIT})`,
    severity: "warning",
    passed: concOk,
    detail: concOk
      ? `${conc} appels simultanés (dans la limite plan ${PLAN_CONCURRENCY_LIMIT}).`
      : `${conc} appels simultanés > limite plan ${PLAN_CONCURRENCY_LIMIT} — les appels au-delà attendront.`,
    remediation:
      `Réduis à ${PLAN_CONCURRENCY_LIMIT} ou passe sur un plan STT supérieur (NEXT_PUBLIC_STT_CONCURRENT_LIMIT).`,
  });

  // ── 10. attempts_reasonable (warning) ───────────────────────────────
  const attempts = Number(input.max_attempts ?? 0);
  const delay = Number(input.retry_delay_min ?? 0);
  const attemptsOk = attempts > 0 && attempts <= 5 && delay >= 5;
  let attemptsDetail: string;
  if (attemptsOk) {
    attemptsDetail = `${attempts} tentatives, délai ${delay} min — raisonnable.`;
  } else if (attempts > 5) {
    attemptsDetail = `${attempts} tentatives > 5 — risque de harcèlement perçu / DNC.`;
  } else if (delay < 5) {
    attemptsDetail = `Délai retry ${delay} min < 5 min — trop rapproché.`;
  } else {
    attemptsDetail = `Valeurs manquantes (tentatives=${attempts}, délai=${delay}).`;
  }
  checks.push({
    id: "attempts_reasonable",
    label: "Tentatives ≤ 5 et délai retry ≥ 5 min",
    severity: "warning",
    passed: attemptsOk,
    detail: attemptsDetail,
    remediation:
      "Étape 3 → Réglages avancés : 3 tentatives + 60 min suffisent généralement.",
  });

  return { checks };
}

/** Convenience: only the blockers that did not pass. */
export function blockingChecks(result: PreflightResult): PreflightCheck[] {
  return result.checks.filter((c) => c.severity === "blocker" && !c.passed);
}

/** True iff no blocker is unresolved. */
export function isPreflightClear(result: PreflightResult): boolean {
  return blockingChecks(result).length === 0;
}
