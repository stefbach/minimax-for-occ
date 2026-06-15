import { supabaseServer } from "@/lib/supabase";
import { resolveDataSource, type DataSource } from "./datasource";
import { renderTemplate, renderDeep, getPath, truthy, type Ctx } from "./templating";
import { generateText, type AnthropicCred } from "./ai";
import { type RunCtx, loadCredential } from "./runtime";
import { runOccStep } from "./steps-occ";

/**
 * Native Axon automation engine ("mini-n8n"), v2.
 *
 * A workflow = a trigger + an ordered list of steps run against a mutable
 * context. Two trigger shapes:
 *   • table_scan — cron-driven; query a data table with filters and run the
 *     steps once per matching row (the row seeds the context).
 *   • callable   — no scan; the steps run once over an input context, used by
 *     sub-automations the orchestrator invokes (see call_automation).
 *
 * Rows can live in a separate Supabase project (the patient pipeline DB) via
 * trigger.data_source_credential_id; definitions/credentials/runs always live
 * in the app DB. Every step reads the context with {{path}} templates and may
 * write its result back under output_key, so later steps — and the AI brains —
 * can build on earlier ones. Idempotence for send steps comes from
 * skip_if_column + mark_column, marked immediately after each successful send.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type FilterOp =
  | "eq" | "neq" | "is_true" | "is_false" | "not_null" | "is_null"
  | "gt" | "lt" | "gte" | "lte" | "like" | "ilike" | "in"
  | "older_than_days" | "newer_than_days";

export interface TriggerConfig {
  type: "table_scan" | "callable";
  every_minutes?: number;
  table?: string;
  filters?: Array<{ column: string; op: FilterOp; value?: string | number }>;
  max_rows_per_run?: number;
  /** org_credentials id (kind 'supabase_data') the rows live in. */
  data_source_credential_id?: string;
  order_by?: { column: string; ascending?: boolean };
}

/** Steps are an open union dispatched by `type`; see executeStep. */
export type StepConfig = { type: string; [k: string]: unknown };

export interface WorkflowRow {
  id: string;
  org_id: string;
  name: string;
  active: boolean;
  trigger: TriggerConfig;
  steps: StepConfig[];
  last_run_at: string | null;
}

export interface RunStats {
  matched: number;
  actions: number;
  skipped: number;
  errors: number;
  log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
  /** Last context (handy for callable automations returning a result). */
  output?: Ctx;
}

// ── Step executors ─────────────────────────────────────────────────────────

async function sendEmailSmtp(
  cred: Record<string, unknown>,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
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
  const waNumber = phone.replace(/^\+/, "");
  const r = await fetch(
    `${base}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(waNumber)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
      },
      body: JSON.stringify({ template_name: templateName, broadcast_name: broadcastName, parameters }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`WATI ${r.status}: ${body.slice(0, 200)}`);
  }
}

async function sendWatiSession(
  cred: Record<string, unknown>,
  phone: string,
  messageText: string,
): Promise<void> {
  const base = String(cred.base_url ?? "").replace(/\/+$/, "");
  const token = String(cred.token ?? "");
  if (!base || !token) throw new Error("WATI credential missing base_url/token");
  const waNumber = phone.replace(/^\+/, "");
  const url = `${base}/api/v1/sendSessionMessage/${encodeURIComponent(waNumber)}?messageText=${encodeURIComponent(messageText)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`WATI session ${r.status}: ${body.slice(0, 200)}`);
  }
}

async function sendTelegram(
  cred: Record<string, unknown>,
  chatId: string,
  text: string,
): Promise<void> {
  const token = String(cred.bot_token ?? cred.token ?? "");
  if (!token) throw new Error("telegram credential missing bot_token");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Telegram ${r.status}: ${body.slice(0, 200)}`);
  }
}

// ── Row matching ─────────────────────────────────────────────────────────

type Queryable = {
  eq: (c: string, v: unknown) => Queryable;
  neq: (c: string, v: unknown) => Queryable;
  gt: (c: string, v: unknown) => Queryable;
  lt: (c: string, v: unknown) => Queryable;
  gte: (c: string, v: unknown) => Queryable;
  lte: (c: string, v: unknown) => Queryable;
  like: (c: string, v: string) => Queryable;
  ilike: (c: string, v: string) => Queryable;
  in: (c: string, v: unknown[]) => Queryable;
  not: (c: string, op: string, v: unknown) => Queryable;
  is: (c: string, v: unknown) => Queryable;
};

function applyFiltersToQuery<T>(q: T, filters: TriggerConfig["filters"]): T {
  let query = q as unknown as Queryable;
  const now = Date.now();
  for (const f of filters ?? []) {
    switch (f.op) {
      case "eq": query = query.eq(f.column, f.value); break;
      case "neq": query = query.neq(f.column, f.value); break;
      case "is_true": query = query.eq(f.column, true); break;
      case "is_false": query = query.eq(f.column, false); break;
      case "not_null": query = query.not(f.column, "is", null); break;
      case "is_null": query = query.is(f.column, null); break;
      case "gt": query = query.gt(f.column, f.value); break;
      case "lt": query = query.lt(f.column, f.value); break;
      case "gte": query = query.gte(f.column, f.value); break;
      case "lte": query = query.lte(f.column, f.value); break;
      case "like": query = query.like(f.column, String(f.value)); break;
      case "ilike": query = query.ilike(f.column, String(f.value)); break;
      case "in": query = query.in(f.column, String(f.value).split(",").map((s) => s.trim())); break;
      case "older_than_days":
        query = query.lte(f.column, new Date(now - Number(f.value) * 86400000).toISOString());
        break;
      case "newer_than_days":
        query = query.gte(f.column, new Date(now - Number(f.value) * 86400000).toISOString());
        break;
    }
  }
  return query as unknown as T;
}

// ── Per-step dispatch ──────────────────────────────────────────────────────

function asAnthropicCred(cred: Record<string, unknown>): AnthropicCred {
  return cred as AnthropicCred;
}

/**
 * Execute one step against the context. Returns "acted" | "skipped" | "error".
 * Steps that produce data write it into ctx under step.output_key.
 */
async function executeStep(rc: RunCtx, step: StepConfig, ctx: Ctx): Promise<void> {
  const table = (rc.ds && (ctx._table as string)) || "";
  const rowId = ctx.id;
  const get = (k: string): string => renderTemplate(String(step[k] ?? ""), ctx);
  const credId = step.credential_id ? String(step.credential_id) : "";

  switch (step.type) {
    // ── messaging / sends (idempotent) ─────────────────────────────────────
    case "send_email_smtp":
    case "send_wati_template":
    case "send_whatsapp_session": {
      const skipCol = step.skip_if_column as string | undefined;
      if (skipCol && truthy(ctx[skipCol])) {
        rc.stats.skipped++;
        return;
      }
      const cred = credId ? await loadCredential(rc, credId) : null;
      if (!cred) {
        rc.log("warn", `row ${rowId}: ${step.type} — credential missing`);
        rc.stats.skipped++;
        return;
      }
      if (step.type === "send_email_smtp") {
        const to = get("to").trim();
        if (!to.includes("@")) {
          rc.log("warn", `row ${rowId}: no valid email (${to || "empty"})`);
          rc.stats.skipped++;
          return;
        }
        await sendEmailSmtp(cred, to, get("subject"), get("html"));
        rc.log("info", `row ${rowId}: email sent to ${to}`);
      } else if (step.type === "send_wati_template") {
        const phone = get("phone").trim();
        if (!phone) { rc.log("warn", `row ${rowId}: no phone`); rc.stats.skipped++; return; }
        const broadcast = `${(step.broadcast_prefix as string) ?? step.template_name}_${rowId}`;
        const params = ((step.parameters as Array<{ name: string; value: string }>) ?? []).map((p) => ({
          name: p.name,
          value: renderTemplate(p.value, ctx),
        }));
        await sendWatiTemplate(cred, phone, String(step.template_name), broadcast, params);
        rc.log("info", `row ${rowId}: WATI template sent to ${phone}`);
      } else {
        const phone = get("phone").trim();
        if (!phone) { rc.log("warn", `row ${rowId}: no phone`); rc.stats.skipped++; return; }
        await sendWatiSession(cred, phone, get("text"));
        rc.log("info", `row ${rowId}: WATI session sent to ${phone}`);
      }
      rc.stats.actions++;
      const markCol = step.mark_column as string | undefined;
      if (markCol && table) {
        const { error } = await rc.ds.client.from(table).update({ [markCol]: true }).eq("id", rowId);
        if (error) rc.log("error", `row ${rowId}: mark ${markCol} failed: ${error.message}`);
        else ctx[markCol] = true;
      }
      return;
    }

    // ── telegram notify ────────────────────────────────────────────────────
    case "telegram_notify": {
      const cred = credId ? await loadCredential(rc, credId) : null;
      if (!cred) { rc.log("warn", "telegram — credential missing"); rc.stats.skipped++; return; }
      const chatId = get("chat_id") || String(cred.chat_id ?? "");
      await sendTelegram(cred, chatId, get("text"));
      rc.stats.actions++;
      return;
    }

    // ── AI brain / supervisor ──────────────────────────────────────────────
    case "ai_brain": {
      const cred = credId ? await loadCredential(rc, credId) : null;
      if (!cred) { rc.log("warn", "ai_brain — anthropic credential missing"); rc.stats.skipped++; return; }
      const text = await generateText({
        cred: asAnthropicCred(cred),
        system: step.system ? get("system") : undefined,
        prompt: get("prompt"),
        model: step.model ? String(step.model) : undefined,
        maxTokens: step.max_tokens ? Number(step.max_tokens) : 800,
      });
      const key = (step.output_key as string) ?? "brain";
      ctx[key] = text;
      if (step.supervisor) {
        const isIssue = /^\s*issue/i.test(text);
        ctx[`${key}_status`] = isIssue ? "issue" : "ok";
        ctx[`${key}_notes`] = text || "OK";
      }
      rc.stats.actions++;
      rc.log("info", `row ${rowId}: ai_brain → ${text.slice(0, 80)}`);
      return;
    }

    // ── generic data ops on the data source ────────────────────────────────
    case "update_row": {
      const patch = renderDeep((step.set as Record<string, unknown>) ?? {}, ctx);
      const target = (step.table as string) || table;
      const idVal = step.match_id ? renderTemplate(String(step.match_id), ctx) : rowId;
      if (Object.keys(patch).length > 0 && target) {
        const { error } = await rc.ds.client.from(target).update(patch).eq("id", idVal);
        if (error) throw new Error(error.message);
        for (const [k, v] of Object.entries(patch)) ctx[k] = v;
        rc.stats.actions++;
      }
      return;
    }

    case "http_request": {
      const url = get("url");
      const method = (step.method as string) ?? "GET";
      const headers = renderDeep((step.headers as Record<string, string>) ?? {}, ctx);
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(60_000) };
      if (step.json_body != null) {
        (init.headers as Record<string, string>)["Content-Type"] = "application/json";
        init.body = JSON.stringify(renderDeep(step.json_body, ctx));
      }
      const r = await fetch(url, init);
      const txt = await r.text().catch(() => "");
      let parsed: unknown = txt;
      try { parsed = JSON.parse(txt); } catch { /* keep text */ }
      if (step.output_key) ctx[String(step.output_key)] = parsed;
      if (!r.ok) throw new Error(`http ${r.status}: ${txt.slice(0, 200)}`);
      rc.stats.actions++;
      return;
    }

    // ── call another automation (orchestrator → sub-agent) ─────────────────
    case "call_automation": {
      if (rc.depth >= 8) {
        rc.log("error", "call_automation: max depth reached");
        rc.stats.errors++;
        return;
      }
      const targetId = String(step.workflow_id ?? "");
      const { data: target } = await rc.app
        .from("org_workflows")
        .select("id, org_id, name, active, trigger, steps, last_run_at")
        .eq("id", targetId)
        .eq("org_id", rc.orgId)
        .maybeSingle();
      if (!target) {
        rc.log("error", `call_automation: workflow ${targetId} not found`);
        rc.stats.errors++;
        return;
      }
      // Build the sub-agent input from the mapping (templated against ctx).
      const input = renderDeep((step.input as Record<string, unknown>) ?? {}, ctx);
      const sub = await runWorkflow(target as unknown as WorkflowRow, input as Ctx, rc.depth + 1);
      // Roll the sub-agent's counters up into this run.
      rc.stats.actions += sub.actions;
      rc.stats.skipped += sub.skipped;
      rc.stats.errors += sub.errors;
      for (const l of sub.log) rc.stats.log.push(l);
      const key = (step.output_key as string) ?? "result";
      ctx[key] = sub.output ?? {};
      rc.log("info", `called ${target.name}: ${sub.actions} actions, ${sub.errors} errors`);
      return;
    }

    default: {
      // OCC compound steps (fetch_patient_context, gmail_ingest_documents,
      // screen_dossier, generate_documents, communicate, …) live in their own
      // module to keep this dispatcher lean.
      const handled = await runOccStep(rc, step, ctx);
      if (!handled) rc.log("warn", `unknown step type ${step.type}`);
      return;
    }
  }
}

// ── Run one workflow ───────────────────────────────────────────────────────

function makeStats(): RunStats {
  return { matched: 0, actions: 0, skipped: 0, errors: 0, log: [] };
}

export async function runWorkflow(wf: WorkflowRow, input?: Ctx, depth = 0): Promise<RunStats> {
  const app = supabaseServer();
  const stats = makeStats();
  const log = (level: "info" | "warn" | "error", msg: string) => {
    stats.log.push({ at: new Date().toISOString(), level, msg });
    if (stats.log.length > 300) stats.log.shift();
  };

  const trig = wf.trigger ?? ({} as TriggerConfig);
  let ds: DataSource;
  try {
    ds = await resolveDataSource(wf.org_id, trig.data_source_credential_id);
  } catch (e) {
    log("error", `data source: ${e instanceof Error ? e.message : String(e)}`);
    stats.errors++;
    return stats;
  }

  const rc: RunCtx = { orgId: wf.org_id, ds, app, creds: new Map(), stats, log, depth };

  // Callable automation: run steps once over the supplied input context
  // (falling back to trigger.test_input so "Run now" can exercise sub-agents).
  if (trig.type === "callable") {
    const seed = input ?? (trig as { test_input?: Ctx }).test_input ?? {};
    const ctx: Ctx = { _now: new Date().toISOString(), ...seed };
    stats.matched = 1;
    await runStepsOnContext(rc, wf.steps ?? [], ctx);
    stats.output = ctx;
    return stats;
  }

  // table_scan (default).
  if (!trig.table) {
    log("error", `unsupported trigger ${JSON.stringify(trig?.type)}`);
    stats.errors++;
    return stats;
  }
  const cap = Math.min(200, Math.max(1, trig.max_rows_per_run ?? 50));
  let q = ds.client.from(trig.table).select("*").limit(cap);
  if (trig.order_by) q = q.order(trig.order_by.column, { ascending: trig.order_by.ascending ?? true });
  q = applyFiltersToQuery(q, trig.filters);
  const { data: rows, error } = await q;
  if (error) {
    log("error", `scan failed: ${error.message}`);
    stats.errors++;
    return stats;
  }
  stats.matched = rows?.length ?? 0;
  if (!rows || rows.length === 0) return stats;

  for (const row of rows as Record<string, unknown>[]) {
    const ctx: Ctx = { ...row, _table: trig.table, _now: new Date().toISOString() };
    await runStepsOnContext(rc, wf.steps ?? [], ctx, true);
  }
  return stats;
}

/**
 * Run an ordered list of steps over a single context. `perRow` keeps one bad
 * row from aborting the batch (table_scan); callable runs surface errors.
 */
export async function runStepsOnContext(
  rc: RunCtx,
  steps: StepConfig[],
  ctx: Ctx,
  perRow = false,
): Promise<void> {
  for (const step of steps) {
    try {
      await executeStep(rc, step, ctx);
    } catch (e) {
      rc.stats.errors++;
      rc.log("error", `${perRow ? `row ${ctx.id} ` : ""}step ${step.type}: ${e instanceof Error ? e.message : String(e)}`);
      if (!perRow && step.stop_on_error !== false) {
        // For callable sub-agents, keep going by default so one failing action
        // doesn't abort the whole pipeline — the orchestrator inspects results.
      }
    }
  }
}

/** Run one workflow and persist a run record + workflow status. */
export async function runWorkflowAndRecord(wf: WorkflowRow, input?: Ctx): Promise<RunStats> {
  const sb = supabaseServer();
  const { data: runRow } = await sb
    .from("org_workflow_runs")
    .insert({ workflow_id: wf.id, org_id: wf.org_id, status: "running" })
    .select("id")
    .single();

  let stats: RunStats;
  try {
    stats = await runWorkflow(wf, input);
  } catch (e) {
    stats = { ...makeStats(), errors: 1 };
    stats.log.push({ at: new Date().toISOString(), level: "error", msg: e instanceof Error ? e.message : String(e) });
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
    .select("id, org_id, name, active, trigger, steps, last_run_at")
    .eq("active", true);
  const out: Array<{ id: string; name: string; stats: RunStats }> = [];
  const now = Date.now();
  for (const raw of (wfs ?? []) as unknown as WorkflowRow[]) {
    // Only table_scan workflows are cron-driven; callable sub-agents run when
    // invoked by an orchestrator, never on their own cadence.
    if (raw.trigger?.type === "callable") continue;
    const every = Math.max(1, Number(raw.trigger?.every_minutes ?? 5));
    const last = raw.last_run_at ? Date.parse(raw.last_run_at) : 0;
    if (now - last < every * 60_000 - 30_000) continue;
    const stats = await runWorkflowAndRecord(raw);
    out.push({ id: raw.id, name: raw.name, stats });
  }
  return out;
}

export { getPath };
