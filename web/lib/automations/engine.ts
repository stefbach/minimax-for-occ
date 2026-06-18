import { supabaseServer } from "@/lib/supabase";

/**
 * Native Axon automation engine ("mini-n8n").
 *
 * A workflow = cron-driven table scan + ordered per-row steps. The canonical
 * OCC use case: every 5 minutes, find leads_rdv rows whose qualification is
 * RDV CONFIRME and whose email_sent / whatsapp_sent flags are still false,
 * send the Stormi Lewis email + the WATI WhatsApp template, then set the
 * flags — the exact semantics of the historical n8n flow, natively.
 *
 * Idempotence model: each send step carries skip_if_column (don't act when
 * the row already has it truthy) and mark_column (set true right after a
 * successful send). A crash between send and mark can at worst re-send once;
 * marking immediately after each row (not at the end of the run) keeps that
 * window to a single row.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface TriggerConfig {
  type: "table_scan";
  every_minutes?: number;
  table: string;
  filters?: Array<{ column: string; op: "eq" | "neq" | "is_true" | "is_false" | "not_null" | "is_null"; value?: string }>;
  max_rows_per_run?: number;
}

export type StepConfig =
  | {
      type: "send_email_smtp";
      credential_id: string;
      to: string; // template, e.g. "{{email}}"
      subject: string;
      html: string;
      skip_if_column?: string;
      mark_column?: string;
    }
  | {
      type: "send_wati_template";
      credential_id: string;
      phone: string; // template
      template_name: string;
      broadcast_prefix?: string;
      parameters?: Array<{ name: string; value: string }>;
      skip_if_column?: string;
      mark_column?: string;
    }
  | {
      type: "update_row";
      set: Record<string, unknown>;
    }
  // ── AI steps: the workflow's management agent drafts the content per row ──
  | {
      // Agent writes a personalised email (subject + HTML) from its directives.
      type: "ai_email";
      credential_id: string;
      to: string; // template, e.g. "{{email}}"
      goal?: string; // extra per-step instruction ("propose un nouveau créneau")
      skip_if_column?: string;
      mark_column?: string;
    }
  | {
      // Agent fills the parameters of an approved WATI template per row.
      type: "ai_whatsapp";
      credential_id: string;
      phone: string; // template
      template_name: string;
      broadcast_prefix?: string;
      param_slots?: Array<{ name: string; hint?: string }>;
      goal?: string;
      skip_if_column?: string;
      mark_column?: string;
    }
  | {
      // Agent decides values for the listed columns from its directives.
      type: "ai_update_row";
      columns: string[];
      goal?: string;
    };

export interface WorkflowRow {
  id: string;
  org_id: string;
  name: string;
  active: boolean;
  trigger: TriggerConfig;
  steps: StepConfig[];
  last_run_at: string | null;
  /** Management agent powering the AI steps (null = no AI steps). */
  agent_id?: string | null;
  /** 'auto' = AI steps send immediately; 'review' = enqueue for approval. */
  approval_mode?: "auto" | "review";
}

/** Minimal agent shape the engine needs to drive an LLM. */
interface AgentBrain {
  id: string;
  llm_provider: string;
  llm_model: string;
  system_prompt: string;
}

interface RunStats {
  matched: number;
  actions: number;
  skipped: number;
  errors: number;
  log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
}

// ── Templating: {{column}} → row value ───────────────────────────────────

function renderTemplate(tpl: string, row: Record<string, unknown>): string {
  return String(tpl ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = row[key];
    return v == null ? "" : String(v);
  });
}

// ── Credentials ──────────────────────────────────────────────────────────

async function loadCredential(orgId: string, credentialId: string): Promise<Record<string, unknown> | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("org_credentials")
    .select("id, kind, data")
    .eq("id", credentialId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data ? { kind: data.kind, ...(data.data as Record<string, unknown>) } : null;
}

// ── Step executors ───────────────────────────────────────────────────────

async function sendEmailSmtp(
  cred: Record<string, unknown>,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  // Lazy import keeps nodemailer out of the edge bundle.
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: String(cred.host ?? "smtp.gmail.com"),
    port: Number(cred.port ?? 465),
    secure: Number(cred.port ?? 465) === 465,
    auth: { user: String(cred.user ?? ""), pass: String(cred.pass ?? "") },
  });
  await transporter.sendMail({
    from: String(cred.from ?? cred.user ?? ""),
    to,
    subject,
    html,
  });
}

async function sendWatiTemplate(
  cred: Record<string, unknown>,
  phone: string,
  templateName: string,
  broadcastName: string,
  parameters: Array<{ name: string; value: string }>,
): Promise<void> {
  const base = String(cred.base_url ?? "").replace(/\/+$/, "");
  const token = String(cred.token ?? "");
  if (!base || !token) throw new Error("WATI credential missing base_url/token");
  // WATI expects the number without the leading '+'.
  const waNumber = phone.replace(/^\+/, "");
  const r = await fetch(
    `${base}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(waNumber)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
      },
      body: JSON.stringify({
        template_name: templateName,
        broadcast_name: broadcastName,
        parameters,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`WATI ${r.status}: ${body.slice(0, 200)}`);
  }
}

// ── AI generation (management agent drafts content per row) ───────────────

async function loadAgentBrain(orgId: string, agentId: string): Promise<AgentBrain | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("agents")
    .select("id, llm_provider, llm_model, system_prompt, purpose")
    .eq("id", agentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    llm_provider: (data.llm_provider as string) ?? "deepseek",
    llm_model: (data.llm_model as string) ?? "deepseek-v4-flash",
    system_prompt: (data.system_prompt as string) ?? "",
  };
}

function providerEndpoint(provider: string): { url: string; key: string | undefined; model_fallback: string } {
  switch (provider) {
    case "openai":
      return { url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model_fallback: "gpt-4o-mini" };
    case "minimax":
      return {
        url: `${(process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/+$/, "")}/chat/completions`,
        key: process.env.MINIMAX_API_KEY,
        model_fallback: "MiniMax-M2",
      };
    case "deepseek":
    default:
      return {
        url: `${(process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "")}/chat/completions`,
        key: process.env.DEEPSEEK_API_KEY,
        model_fallback: "deepseek-v4-flash",
      };
  }
}

/**
 * Run the agent's LLM and return a parsed JSON object. The agent's directives
 * (system_prompt) drive tone/rules; `instruction` carries the row + output
 * contract. Anthropic uses its Messages API; everything else is OpenAI-
 * compatible chat/completions with JSON response mode.
 */
async function agentGenerateJson(agent: AgentBrain, instruction: string): Promise<Record<string, unknown>> {
  const system = `${agent.system_prompt}\n\nTu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans bloc de code.`;

  if (agent.llm_provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY manquante pour l'agent");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: agent.llm_model?.startsWith("claude") ? agent.llm_model : "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system,
        messages: [{ role: "user", content: instruction }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { content?: Array<{ text?: string }> };
    return parseJsonLoose(j.content?.map((c) => c.text ?? "").join("") ?? "");
  }

  const { url, key, model_fallback } = providerEndpoint(agent.llm_provider);
  if (!key) throw new Error(`Clé API manquante pour le fournisseur ${agent.llm_provider}`);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: agent.llm_model || model_fallback,
      messages: [
        { role: "system", content: system },
        { role: "user", content: instruction },
      ],
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseJsonLoose(j.choices?.[0]?.message?.content ?? "");
}

function parseJsonLoose(text: string): Record<string, unknown> {
  const t = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    // Last resort: grab the first {...} block.
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    throw new Error("réponse LLM non-JSON");
  }
}

function rowContext(row: Record<string, unknown>): string {
  // Compact JSON of the row so the agent personalises from real fields.
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    if (typeof v === "string" && v.length > 500) slim[k] = v.slice(0, 500);
    else slim[k] = v;
  }
  return JSON.stringify(slim);
}

/** Coerce whatever JSON shape the agent returned into WATI [{name,value}]. */
function normalizeWatiParams(
  out: Record<string, unknown>,
  slots?: Array<{ name: string; hint?: string }>,
): Array<{ name: string; value: string }> {
  const result: Array<{ name: string; value: string }> = [];
  const raw = out.parameters ?? out.values;
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p && typeof p === "object" && "name" in (p as object)) {
        const o = p as { name: unknown; value?: unknown };
        result.push({ name: String(o.name), value: String(o.value ?? "") });
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      result.push({ name: k, value: String(v ?? "") });
    }
  }
  // If the agent ignored the contract, at least emit empty slots so the
  // template still has the right arity.
  if (result.length === 0 && slots) {
    for (const s of slots) result.push({ name: s.name, value: "" });
  }
  return result;
}

// ── Row matching ─────────────────────────────────────────────────────────

function applyFiltersToQuery<T>(q: T, filters: TriggerConfig["filters"]): T {
  let query = q as unknown as {
    eq: (c: string, v: unknown) => unknown;
    neq: (c: string, v: unknown) => unknown;
    not: (c: string, op: string, v: unknown) => unknown;
    is: (c: string, v: unknown) => unknown;
  };
  for (const f of filters ?? []) {
    switch (f.op) {
      case "eq":
        query = query.eq(f.column, f.value) as typeof query;
        break;
      case "neq":
        query = query.neq(f.column, f.value) as typeof query;
        break;
      case "is_true":
        query = query.eq(f.column, true) as typeof query;
        break;
      case "is_false":
        query = query.eq(f.column, false) as typeof query;
        break;
      case "not_null":
        query = query.not(f.column, "is", null) as typeof query;
        break;
      case "is_null":
        query = query.is(f.column, null) as typeof query;
        break;
    }
  }
  return query as unknown as T;
}

// ── Main runner ──────────────────────────────────────────────────────────

export async function runWorkflow(wf: WorkflowRow, runId?: string): Promise<RunStats> {
  const sb = supabaseServer();
  const stats: RunStats = { matched: 0, actions: 0, skipped: 0, errors: 0, log: [] };
  const logLine = (level: "info" | "warn" | "error", msg: string) => {
    stats.log.push({ at: new Date().toISOString(), level, msg });
    if (stats.log.length > 200) stats.log.shift();
  };

  const trig = wf.trigger;
  if (trig?.type !== "table_scan" || !trig.table) {
    logLine("error", `unsupported trigger ${JSON.stringify(trig?.type)}`);
    stats.errors++;
    return stats;
  }

  const cap = Math.min(200, Math.max(1, trig.max_rows_per_run ?? 50));
  let q = sb.from(trig.table).select("*").limit(cap);
  q = applyFiltersToQuery(q, trig.filters);
  const { data: rows, error } = await q;
  if (error) {
    logLine("error", `scan failed: ${error.message}`);
    stats.errors++;
    return stats;
  }
  stats.matched = rows?.length ?? 0;
  if (!rows || rows.length === 0) return stats;

  // Resolve credentials once per run (id → data).
  const credIds = new Set<string>();
  for (const s of wf.steps) {
    if ("credential_id" in s && s.credential_id) credIds.add(s.credential_id);
  }
  const creds = new Map<string, Record<string, unknown>>();
  for (const id of credIds) {
    const c = await loadCredential(wf.org_id, id);
    if (c) creds.set(id, c);
    else logLine("warn", `credential ${id} not found`);
  }

  // Load the management agent once if any AI step needs it.
  const needsAgent = wf.steps.some(
    (s) => s.type === "ai_email" || s.type === "ai_whatsapp" || s.type === "ai_update_row",
  );
  let agent: AgentBrain | null = null;
  if (needsAgent) {
    if (!wf.agent_id) {
      logLine("error", "étapes IA présentes mais aucun agent de gestion lié au workflow");
      stats.errors++;
    } else {
      agent = await loadAgentBrain(wf.org_id, wf.agent_id);
      if (!agent) {
        logLine("error", `agent ${wf.agent_id} introuvable`);
        stats.errors++;
      }
    }
  }
  const reviewMode = wf.approval_mode === "review";
  const enqueueAction = async (
    channel: "email" | "whatsapp" | "update_row",
    rowIdVal: unknown,
    payload: Record<string, unknown>,
  ) => {
    await sb.from("org_workflow_actions").insert({
      org_id: wf.org_id,
      workflow_id: wf.id,
      run_id: runId ?? null,
      agent_id: wf.agent_id ?? null,
      channel,
      table_name: trig.table,
      row_id: String(rowIdVal ?? ""),
      payload,
      status: "pending",
    });
  };

  for (const row of rows as Record<string, unknown>[]) {
    const rowId = row.id;
    for (const step of wf.steps) {
      try {
        if (step.type === "send_email_smtp" || step.type === "send_wati_template") {
          // Per-step idempotence gate.
          if (step.skip_if_column && row[step.skip_if_column]) {
            stats.skipped++;
            continue;
          }
          const cred = creds.get(step.credential_id);
          if (!cred) {
            logLine("warn", `row ${rowId}: skipping ${step.type} — credential missing`);
            stats.skipped++;
            continue;
          }
          if (step.type === "send_email_smtp") {
            const to = renderTemplate(step.to, row).trim();
            if (!to || !to.includes("@")) {
              logLine("warn", `row ${rowId}: no valid email (${to || "empty"})`);
              stats.skipped++;
              continue;
            }
            await sendEmailSmtp(
              cred,
              to,
              renderTemplate(step.subject, row),
              renderTemplate(step.html, row),
            );
            logLine("info", `row ${rowId}: email sent to ${to}`);
          } else {
            const phone = renderTemplate(step.phone, row).trim();
            if (!phone) {
              logLine("warn", `row ${rowId}: no phone`);
              stats.skipped++;
              continue;
            }
            const broadcast = `${step.broadcast_prefix ?? step.template_name}_${rowId}`;
            await sendWatiTemplate(
              cred,
              phone,
              step.template_name,
              broadcast,
              (step.parameters ?? []).map((p) => ({
                name: p.name,
                value: renderTemplate(p.value, row),
              })),
            );
            logLine("info", `row ${rowId}: WATI template sent to ${phone}`);
          }
          stats.actions++;
          // Mark immediately so a crash later in the run can't double-send
          // this row's step.
          if (step.mark_column) {
            const { error: mErr } = await sb
              .from(trig.table)
              .update({ [step.mark_column]: true })
              .eq("id", rowId);
            if (mErr) logLine("error", `row ${rowId}: mark ${step.mark_column} failed: ${mErr.message}`);
            else (row as Record<string, unknown>)[step.mark_column] = true;
          }
        } else if (step.type === "update_row") {
          const patch: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(step.set ?? {})) {
            patch[k] = typeof v === "string" ? renderTemplate(v, row) : v;
          }
          if (Object.keys(patch).length > 0) {
            const { error: uErr } = await sb.from(trig.table).update(patch).eq("id", rowId);
            if (uErr) throw new Error(uErr.message);
            stats.actions++;
          }
        } else if (step.type === "ai_email") {
          if (step.skip_if_column && row[step.skip_if_column]) { stats.skipped++; continue; }
          if (!agent) { stats.skipped++; continue; }
          const to = renderTemplate(step.to, row).trim();
          if (!to.includes("@")) {
            logLine("warn", `row ${rowId}: ai_email — email invalide (${to || "vide"})`);
            stats.skipped++; continue;
          }
          const out = await agentGenerateJson(
            agent,
            `Rédige un email personnalisé pour ce contact selon tes directives.${step.goal ? ` Objectif : ${step.goal}.` : ""}\nDonnées de la fiche (JSON) : ${rowContext(row)}\nRéponds en JSON : {"subject": "...", "html": "<p>...</p>"} — corps en HTML simple.`,
          );
          const subject = String(out.subject ?? "").trim();
          const html = String((out.html ?? out.body) ?? "").trim();
          if (!subject || !html) { logLine("warn", `row ${rowId}: ai_email — l'agent n'a pas produit d'email`); stats.skipped++; continue; }
          if (reviewMode) {
            await enqueueAction("email", rowId, { credential_id: step.credential_id, to, subject, html, mark_column: step.mark_column ?? null });
            logLine("info", `row ${rowId}: email rédigé, en attente de validation`);
            stats.actions++;
          } else {
            const cred = creds.get(step.credential_id);
            if (!cred) { logLine("warn", `row ${rowId}: ai_email — credential manquant`); stats.skipped++; continue; }
            await sendEmailSmtp(cred, to, subject, html);
            logLine("info", `row ${rowId}: ai_email envoyé à ${to}`);
            stats.actions++;
            if (step.mark_column) {
              await sb.from(trig.table).update({ [step.mark_column]: true }).eq("id", rowId);
              (row as Record<string, unknown>)[step.mark_column] = true;
            }
          }
        } else if (step.type === "ai_whatsapp") {
          if (step.skip_if_column && row[step.skip_if_column]) { stats.skipped++; continue; }
          if (!agent) { stats.skipped++; continue; }
          const phone = renderTemplate(step.phone, row).trim();
          if (!phone) { logLine("warn", `row ${rowId}: ai_whatsapp — pas de téléphone`); stats.skipped++; continue; }
          const slots = (step.param_slots ?? []).map((s) => `${s.name}${s.hint ? ` (${s.hint})` : ""}`).join(", ") || "aucune";
          const out = await agentGenerateJson(
            agent,
            `Remplis les variables du template WhatsApp « ${step.template_name} » pour ce contact selon tes directives.${step.goal ? ` Objectif : ${step.goal}.` : ""}\nVariables attendues : ${slots}\nDonnées de la fiche (JSON) : ${rowContext(row)}\nRéponds en JSON : {"parameters": [{"name": "...", "value": "..."}]}`,
          );
          const parameters = normalizeWatiParams(out, step.param_slots);
          if (reviewMode) {
            await enqueueAction("whatsapp", rowId, { credential_id: step.credential_id, phone, template_name: step.template_name, broadcast_prefix: step.broadcast_prefix ?? null, parameters, mark_column: step.mark_column ?? null });
            logLine("info", `row ${rowId}: WhatsApp préparé, en attente de validation`);
            stats.actions++;
          } else {
            const cred = creds.get(step.credential_id);
            if (!cred) { logLine("warn", `row ${rowId}: ai_whatsapp — credential manquant`); stats.skipped++; continue; }
            const broadcast = `${step.broadcast_prefix ?? step.template_name}_${rowId}`;
            await sendWatiTemplate(cred, phone, step.template_name, broadcast, parameters);
            logLine("info", `row ${rowId}: ai_whatsapp envoyé à ${phone}`);
            stats.actions++;
            if (step.mark_column) {
              await sb.from(trig.table).update({ [step.mark_column]: true }).eq("id", rowId);
              (row as Record<string, unknown>)[step.mark_column] = true;
            }
          }
        } else if (step.type === "ai_update_row") {
          if (!agent) { stats.skipped++; continue; }
          const cols = step.columns ?? [];
          if (cols.length === 0) { stats.skipped++; continue; }
          const out = await agentGenerateJson(
            agent,
            `Détermine les valeurs des colonnes suivantes pour cette fiche selon tes directives : ${cols.join(", ")}.${step.goal ? ` Objectif : ${step.goal}.` : ""}\nDonnées de la fiche (JSON) : ${rowContext(row)}\nRéponds en JSON : {"set": { <colonne>: <valeur> }} — n'inclus QUE ces colonnes.`,
          );
          const rawSet = (out.set && typeof out.set === "object" ? out.set : out) as Record<string, unknown>;
          const patch: Record<string, unknown> = {};
          for (const c of cols) if (c in rawSet) patch[c] = rawSet[c];
          if (Object.keys(patch).length === 0) { stats.skipped++; continue; }
          if (reviewMode) {
            await enqueueAction("update_row", rowId, { set: patch });
            logLine("info", `row ${rowId}: mise à jour préparée, en attente de validation`);
            stats.actions++;
          } else {
            const { error: uErr } = await sb.from(trig.table).update(patch).eq("id", rowId);
            if (uErr) throw new Error(uErr.message);
            logLine("info", `row ${rowId}: ai_update_row appliqué (${Object.keys(patch).join(", ")})`);
            stats.actions++;
          }
        }
      } catch (e) {
        stats.errors++;
        logLine("error", `row ${rowId} step ${step.type}: ${e instanceof Error ? e.message : String(e)}`);
        // Continue with the next row — one bad lead shouldn't block the batch.
      }
    }
  }
  return stats;
}

/** Run one workflow and persist a run record + workflow status. */
export async function runWorkflowAndRecord(wf: WorkflowRow): Promise<RunStats> {
  const sb = supabaseServer();
  const { data: runRow } = await sb
    .from("org_workflow_runs")
    .insert({ workflow_id: wf.id, org_id: wf.org_id, status: "running" })
    .select("id")
    .single();

  let stats: RunStats;
  try {
    stats = await runWorkflow(wf, runRow?.id as string | undefined);
  } catch (e) {
    stats = {
      matched: 0, actions: 0, skipped: 0, errors: 1,
      log: [{ at: new Date().toISOString(), level: "error", msg: e instanceof Error ? e.message : String(e) }],
    };
  }
  const status = stats.errors > 0 ? (stats.actions > 0 ? "ok" : "error") : "ok";
  if (runRow?.id) {
    await sb
      .from("org_workflow_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        matched: stats.matched,
        actions: stats.actions,
        skipped: stats.skipped,
        errors: stats.errors,
        log: stats.log,
      })
      .eq("id", runRow.id);
  }
  await sb
    .from("org_workflows")
    .update({ last_run_at: new Date().toISOString(), last_status: status })
    .eq("id", wf.id);
  return stats;
}

/** Cron entrypoint: run every active workflow whose cadence is due. */
export async function runDueWorkflows(): Promise<Array<{ id: string; name: string; stats: RunStats }>> {
  const sb = supabaseServer();
  const { data: wfs } = await sb
    .from("org_workflows")
    .select("id, org_id, name, active, trigger, steps, last_run_at, agent_id, approval_mode")
    .eq("active", true);
  const out: Array<{ id: string; name: string; stats: RunStats }> = [];
  const now = Date.now();
  for (const raw of (wfs ?? []) as unknown as WorkflowRow[]) {
    const every = Math.max(1, Number(raw.trigger?.every_minutes ?? 5));
    const last = raw.last_run_at ? Date.parse(raw.last_run_at) : 0;
    if (now - last < every * 60_000 - 30_000) continue; // not due yet (30s tolerance)
    const stats = await runWorkflowAndRecord(raw);
    out.push({ id: raw.id, name: raw.name, stats });
  }
  return out;
}

/**
 * Execute one approved action from the review queue: send the drafted
 * email/WhatsApp (or apply the row update), mark the source row, and flip the
 * action's status. Called by the approval API on "approve".
 */
export async function executeQueuedAction(
  orgId: string,
  actionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseServer();
  const { data: action } = await sb
    .from("org_workflow_actions")
    .select("id, org_id, channel, table_name, row_id, payload, status")
    .eq("id", actionId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!action) return { ok: false, error: "action introuvable" };
  if ((action.status as string) !== "pending") return { ok: false, error: `action déjà ${action.status}` };

  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const channel = action.channel as string;
  const table = action.table_name as string;
  const rowId = action.row_id as string;

  try {
    if (channel === "email") {
      const cred = await loadCredential(orgId, String(payload.credential_id ?? ""));
      if (!cred) throw new Error("credential email introuvable");
      await sendEmailSmtp(cred, String(payload.to ?? ""), String(payload.subject ?? ""), String(payload.html ?? ""));
      if (payload.mark_column) await sb.from(table).update({ [String(payload.mark_column)]: true }).eq("id", rowId);
    } else if (channel === "whatsapp") {
      const cred = await loadCredential(orgId, String(payload.credential_id ?? ""));
      if (!cred) throw new Error("credential WhatsApp introuvable");
      const tmpl = String(payload.template_name ?? "");
      const broadcast = `${(payload.broadcast_prefix as string) ?? tmpl}_${rowId}`;
      const params = Array.isArray(payload.parameters)
        ? (payload.parameters as Array<{ name: string; value: string }>)
        : [];
      await sendWatiTemplate(cred, String(payload.phone ?? ""), tmpl, broadcast, params);
      if (payload.mark_column) await sb.from(table).update({ [String(payload.mark_column)]: true }).eq("id", rowId);
    } else if (channel === "update_row") {
      const set = (payload.set ?? {}) as Record<string, unknown>;
      if (Object.keys(set).length > 0) {
        const { error } = await sb.from(table).update(set).eq("id", rowId);
        if (error) throw new Error(error.message);
      }
    } else {
      throw new Error(`canal inconnu: ${channel}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("org_workflow_actions")
      .update({ status: "failed", error: msg, decided_at: new Date().toISOString() })
      .eq("id", actionId);
    return { ok: false, error: msg };
  }

  await sb
    .from("org_workflow_actions")
    .update({ status: "sent", decided_at: new Date().toISOString() })
    .eq("id", actionId);
  return { ok: true };
}
