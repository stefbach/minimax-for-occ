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
    };

export interface WorkflowRow {
  id: string;
  org_id: string;
  name: string;
  active: boolean;
  trigger: TriggerConfig;
  steps: StepConfig[];
  last_run_at: string | null;
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

export async function runWorkflow(wf: WorkflowRow): Promise<RunStats> {
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
    stats = await runWorkflow(wf);
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
    .select("id, org_id, name, active, trigger, steps, last_run_at")
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
