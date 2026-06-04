/**
 * IVR runtime — TwiML renderer for `flow_steps` rows.
 *
 * The IVR flow editor (web/app/(client)/flows/[id]/edit/FlowEditor.tsx)
 * persists a directed graph in two tables:
 *   - flow_steps(id, flow_id, kind, label, config jsonb, position jsonb)
 *   - flow_edges(id, flow_id, from_step_id, to_step_id, condition jsonb, position)
 *
 * Known step kinds (from the editor):
 *   welcome, menu_dtmf, gather_speech, ai_agent, transfer, route_queue,
 *   voicemail, hangup.
 *
 * The task brief uses a slightly different set of names — we map them
 * to the kinds the builder actually writes:
 *   - "say"           → welcome
 *   - "play_audio"    → welcome with config.audio_url
 *   - "transfer_pstn" → transfer
 *
 * Edges carry a `condition` jsonb. Today the editor produces three shapes:
 *   { kind: "always" }                 — taken unconditionally
 *   { kind: "dtmf",   key: "1" }       — taken when caller pressed "1"
 *   { kind: "speech", keywords: [...]} — substring match on SpeechResult
 *
 * For menu_dtmf we also accept config.options = [{ key, label, next_step_id }]
 * as an alternative way to express branches (legacy / brief-style).
 */

export type FlowStep = {
  id: string;
  flow_id: string;
  kind: string;
  label: string | null;
  config: Record<string, unknown>;
};

export type FlowEdge = {
  id: string;
  flow_id: string;
  from_step_id: string;
  to_step_id: string;
  condition: Record<string, unknown>;
  position: number;
};

export type RenderCtx = {
  flow_id: string;
  base_url: string; // e.g. "https://example.com" — no trailing slash
  voice: string; // TwiML voice attribute, e.g. "alice"
  language: string; // e.g. "fr-FR"
  /** Steps and edges of the whole flow, indexed by id for cheap lookups. */
  stepsById: Map<string, FlowStep>;
  edgesByFrom: Map<string, FlowEdge[]>;
};

export function buildRenderCtx(args: {
  flow_id: string;
  base_url: string;
  voice?: string | null;
  language?: string | null;
  steps: FlowStep[];
  edges: FlowEdge[];
}): RenderCtx {
  const stepsById = new Map<string, FlowStep>();
  for (const s of args.steps) stepsById.set(s.id, s);
  const edgesByFrom = new Map<string, FlowEdge[]>();
  for (const e of args.edges) {
    const list = edgesByFrom.get(e.from_step_id) ?? [];
    list.push(e);
    edgesByFrom.set(e.from_step_id, list);
  }
  // Stable order edges by position.
  for (const list of edgesByFrom.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  return {
    flow_id: args.flow_id,
    base_url: args.base_url.replace(/\/+$/, ""),
    voice: args.voice || "alice",
    language: args.language || "fr-FR",
    stepsById,
    edgesByFrom,
  };
}

/* ─── XML helpers ────────────────────────────────────────────────────── */

export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function wrapResponse(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
}

function s(cfg: Record<string, unknown>, key: string): string | null {
  const v = cfg[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function n(cfg: Record<string, unknown>, key: string): number | null {
  const v = cfg[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ─── Renderer dispatcher ────────────────────────────────────────────── */

/**
 * Render a single step into a TwiML fragment (no <?xml?> / <Response>
 * wrapper). Returns the inner XML to be embedded in wrapResponse().
 *
 * The renderer is intentionally stateless: it never reads or writes the
 * DB. The caller resolves the step, then calls renderStep(). For
 * branching steps (menu_dtmf, gather_speech) the renderer emits a
 * <Gather action="…/handle?from={step.id}"> pointing back at the handle
 * endpoint, which re-enters the renderer with the next step.
 */
export function renderStep(step: FlowStep, ctx: RenderCtx): string {
  const cfg = (step.config ?? {}) as Record<string, unknown>;

  switch (step.kind) {
    case "welcome":
    case "say": {
      // play_audio is sometimes shipped as welcome+audio_url; honour both.
      const audioUrl = s(cfg, "audio_url") || s(cfg, "url");
      if (audioUrl) {
        return `<Play>${escapeXml(audioUrl)}</Play>` + nextRedirect(step, ctx);
      }
      const text =
        s(cfg, "text") ||
        s(cfg, "tts") ||
        s(cfg, "prompt") ||
        s(cfg, "message") ||
        step.label ||
        "";
      const say = text ? sayTag(text, ctx) : "";
      return say + nextRedirect(step, ctx);
    }

    case "play_audio": {
      const url = s(cfg, "url") || s(cfg, "audio_url");
      if (!url) {
        return sayTag("Audio non disponible.", ctx) + nextRedirect(step, ctx);
      }
      return `<Play>${escapeXml(url)}</Play>` + nextRedirect(step, ctx);
    }

    case "menu_dtmf": {
      const prompt = s(cfg, "prompt") || s(cfg, "text") || step.label || "";
      const timeout = n(cfg, "timeout_s") ?? 5;
      const numDigits = n(cfg, "num_digits") ?? 1;
      const action = `${ctx.base_url}/api/flows/${ctx.flow_id}/twiml/handle?from=${encodeURIComponent(step.id)}`;
      const gatherInner = prompt ? sayTag(prompt, ctx) : "";
      return (
        `<Gather input="dtmf" numDigits="${numDigits}" timeout="${timeout}" action="${escapeXml(action)}" method="POST">` +
        gatherInner +
        `</Gather>` +
        // If caller times out, fall through: re-prompt or hang up gracefully.
        sayTag("Aucune saisie reçue.", ctx) +
        `<Hangup/>`
      );
    }

    case "gather_speech": {
      const prompt = s(cfg, "prompt") || s(cfg, "text") || step.label || "";
      const lang = s(cfg, "language") || ctx.language;
      const timeout = n(cfg, "timeout_s") ?? 6;
      const action = `${ctx.base_url}/api/flows/${ctx.flow_id}/twiml/handle?from=${encodeURIComponent(step.id)}`;
      const gatherInner = prompt ? sayTag(prompt, ctx, lang) : "";
      return (
        `<Gather input="speech" language="${escapeXml(lang)}" speechTimeout="auto" timeout="${timeout}" action="${escapeXml(action)}" method="POST">` +
        gatherInner +
        `</Gather>` +
        sayTag("Je n'ai pas compris.", ctx) +
        `<Hangup/>`
      );
    }

    case "route_queue": {
      // queue_name on the step config, fallback to label, fallback to default.
      const queueName =
        s(cfg, "queue_name") || s(cfg, "name") || step.label || "default";
      const waitUrl =
        s(cfg, "wait_url") ||
        `${ctx.base_url}/api/twilio/queue-wait?lang=${encodeURIComponent(ctx.language.toLowerCase().startsWith("en") ? "en" : "fr")}`;
      return `<Enqueue waitUrl="${escapeXml(waitUrl)}" waitUrlMethod="POST">${escapeXml(queueName)}</Enqueue>`;
    }

    case "ai_agent": {
      // Hand off to the legacy /api/twilio-voice handler that bridges
      // into LiveKit so the IA agent picks up.
      return `<Redirect method="POST">${escapeXml(ctx.base_url + "/api/twilio-voice")}</Redirect>`;
    }

    case "voicemail": {
      const prompt = s(cfg, "prompt") || s(cfg, "text") || "Laissez votre message après le bip.";
      const maxLen = n(cfg, "max_duration_s") ?? 60;
      const recordAction = `${ctx.base_url}/api/twilio/recording`;
      return (
        sayTag(prompt, ctx) +
        `<Record maxLength="${maxLen}" playBeep="true" action="${escapeXml(recordAction)}" method="POST" finishOnKey="#" />` +
        `<Hangup/>`
      );
    }

    case "transfer":
    case "transfer_pstn": {
      const to = s(cfg, "to_e164") || s(cfg, "number") || s(cfg, "to");
      if (!to) {
        return sayTag("Numéro de transfert manquant.", ctx) + `<Hangup/>`;
      }
      const ringTimeout = n(cfg, "ring_timeout_s") ?? 25;
      return `<Dial timeout="${ringTimeout}">${escapeXml(to)}</Dial>`;
    }

    case "hangup": {
      return `<Hangup/>`;
    }

    default: {
      // Unknown step type — apologise and hang up rather than crash.
      return (
        sayTag("Cette étape n'est pas encore configurée.", ctx) +
        `<Hangup/>`
      );
    }
  }
}

function sayTag(text: string, ctx: RenderCtx, lang?: string): string {
  const language = lang || ctx.language;
  return `<Say voice="${escapeXml(ctx.voice)}" language="${escapeXml(language)}">${escapeXml(text)}</Say>`;
}

/**
 * After non-branching steps (welcome, play_audio, etc.) we follow the
 * outgoing "always" edge to chain to the next step. For terminal steps
 * (hangup, route_queue, transfer, voicemail) we don't call this; those
 * render their own terminator.
 */
function nextRedirect(step: FlowStep, ctx: RenderCtx): string {
  const next = pickAlwaysNext(step.id, ctx);
  if (!next) {
    // No successor — hang up cleanly.
    return `<Hangup/>`;
  }
  // Inline-render the next step rather than redirect, to save one HTTP
  // roundtrip per step. Avoid infinite recursion via a depth counter.
  return inlineNext(next, ctx, 0);
}

function inlineNext(stepId: string, ctx: RenderCtx, depth: number): string {
  if (depth > 12) {
    // Defensive bound. A real flow shouldn't chain more than a handful of
    // sequential "say" steps; if it does we redirect instead of recursing.
    const url = `${ctx.base_url}/api/flows/${ctx.flow_id}/twiml/handle?from=__chain__&next=${encodeURIComponent(stepId)}`;
    return `<Redirect method="POST">${escapeXml(url)}</Redirect>`;
  }
  const step = ctx.stepsById.get(stepId);
  if (!step) return sayTag("Étape introuvable.", ctx) + `<Hangup/>`;
  return renderStepInternal(step, ctx, depth + 1);
}

/**
 * Internal renderer used when chaining inline. Identical to renderStep
 * except it propagates the recursion depth on the chain helper.
 */
function renderStepInternal(step: FlowStep, ctx: RenderCtx, depth: number): string {
  // We re-implement the welcome/play_audio branch here to pass `depth`.
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  if (step.kind === "welcome" || step.kind === "say" || step.kind === "play_audio") {
    const audioUrl = s(cfg, "audio_url") || s(cfg, "url");
    const head = (() => {
      if (step.kind === "play_audio" || audioUrl) {
        const url = audioUrl ?? s(cfg, "url");
        return url ? `<Play>${escapeXml(url)}</Play>` : sayTag("Audio non disponible.", ctx);
      }
      const text =
        s(cfg, "text") ||
        s(cfg, "tts") ||
        s(cfg, "prompt") ||
        s(cfg, "message") ||
        step.label ||
        "";
      return text ? sayTag(text, ctx) : "";
    })();
    const next = pickAlwaysNext(step.id, ctx);
    if (!next) return head + `<Hangup/>`;
    return head + inlineNext(next, ctx, depth);
  }
  // For all other kinds, defer to the public renderer.
  return renderStep(step, ctx);
}

/**
 * Pick the next step via an "always" edge. If multiple edges exist, the
 * first by position wins. Returns null if no edge matches.
 */
function pickAlwaysNext(fromStepId: string, ctx: RenderCtx): string | null {
  const edges = ctx.edgesByFrom.get(fromStepId) ?? [];
  for (const e of edges) {
    const kind = (e.condition?.kind as string | undefined) ?? "always";
    if (kind === "always") return e.to_step_id;
  }
  // Tolerance: if the only outgoing edge is conditional, fall back to it.
  if (edges.length === 1) return edges[0].to_step_id;
  return null;
}

/* ─── Handler resolution ─────────────────────────────────────────────── */

/**
 * Resolve the next step after a gather_dtmf based on the digit pressed.
 *
 * Two ways the next step can be expressed:
 *   1. flow_edges row with condition = { kind: "dtmf", key: "1" }
 *   2. step.config.options = [{ key: "1", next_step_id: "..." }, ...]
 *      (Legacy / brief-style. The current editor doesn't write this but
 *      we honour it if present.)
 */
export function resolveDtmfNext(
  fromStep: FlowStep,
  digits: string,
  ctx: RenderCtx,
): FlowStep | null {
  // 1. Edge-based routing.
  const edges = ctx.edgesByFrom.get(fromStep.id) ?? [];
  for (const e of edges) {
    const c = e.condition ?? {};
    if (c.kind === "dtmf" && typeof c.key === "string" && c.key === digits) {
      return ctx.stepsById.get(e.to_step_id) ?? null;
    }
  }
  // 2. Config-options routing.
  const opts = (fromStep.config?.options as Array<{ key?: string; next_step_id?: string }> | undefined) ?? [];
  for (const o of opts) {
    if (o && typeof o.key === "string" && o.key === digits && typeof o.next_step_id === "string") {
      return ctx.stepsById.get(o.next_step_id) ?? null;
    }
  }
  // 3. Fall back to "always" successor (default branch).
  const alwaysId = pickAlwaysNext(fromStep.id, ctx);
  return alwaysId ? ctx.stepsById.get(alwaysId) ?? null : null;
}

/**
 * Resolve the next step after a gather_speech based on captured speech.
 *
 * Edge conditions:
 *   { kind: "speech", keywords: ["rdv", "rendez-vous"] }
 *   { kind: "intent", value: "book" } — treated as a single keyword
 *
 * Simple case-insensitive substring match. No LLM.
 */
export function resolveSpeechNext(
  fromStep: FlowStep,
  speech: string,
  ctx: RenderCtx,
): FlowStep | null {
  const norm = speech.toLowerCase();
  const edges = ctx.edgesByFrom.get(fromStep.id) ?? [];
  for (const e of edges) {
    const c = e.condition ?? {};
    if (c.kind === "speech" || c.kind === "intent") {
      const keywords = collectKeywords(c);
      if (keywords.some((k) => norm.includes(k.toLowerCase()))) {
        return ctx.stepsById.get(e.to_step_id) ?? null;
      }
    }
  }
  const alwaysId = pickAlwaysNext(fromStep.id, ctx);
  return alwaysId ? ctx.stepsById.get(alwaysId) ?? null : null;
}

function collectKeywords(cond: Record<string, unknown>): string[] {
  const out: string[] = [];
  const kws = cond.keywords;
  if (Array.isArray(kws)) {
    for (const k of kws) if (typeof k === "string" && k.trim()) out.push(k.trim());
  }
  const key = cond.key;
  if (typeof key === "string" && key.trim()) out.push(key.trim());
  const value = cond.value;
  if (typeof value === "string" && value.trim()) out.push(value.trim());
  return out;
}

/* ─── Absolute URL helper ────────────────────────────────────────────── */

export function absoluteOrigin(req: Request): string {
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    "";
  if (host) return `${proto}://${host}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}
