"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface MgmtAgentOption {
  id: string;
  name: string;
}
export interface WfDataTable {
  id: string;
  label: string;
  physical_table: string;
  phone_column: string;
  columns: Array<{ key: string; label: string; type: string }>;
}
export interface WfCredential {
  id: string;
  name: string;
  kind: string;
}

/**
 * Create a workflow driven by a management agent. The operator binds: an agent
 * (the brain), a table (the source), one or more channels (email / WhatsApp /
 * row update) with a connection, a cadence and an approval mode. A JSON import
 * shortcut is offered for power users.
 */
export function AgentWorkflowForm({
  agents,
  dataTables,
  credentials,
}: {
  agents: MgmtAgentOption[];
  dataTables: WfDataTable[];
  credentials: WfCredential[];
}) {
  const router = useRouter();
  const smtpCreds = credentials.filter((c) => c.kind === "smtp");
  const watiCreds = credentials.filter((c) => c.kind === "wati");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [tableId, setTableId] = useState(dataTables[0]?.id ?? "");
  const selectedTable = useMemo(
    () => dataTables.find((t) => t.id === tableId) ?? null,
    [dataTables, tableId],
  );
  const columns = selectedTable?.columns ?? [];

  // Optional status filter
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValue, setFilterValue] = useState("");

  // Channels
  const emailColGuess = columns.find((c) => /mail/i.test(c.key))?.key ?? "";
  const [emailOn, setEmailOn] = useState(false);
  const [emailCred, setEmailCred] = useState(smtpCreds[0]?.id ?? "");
  const [emailToCol, setEmailToCol] = useState(emailColGuess);
  const [emailGoal, setEmailGoal] = useState("");
  const [emailMark, setEmailMark] = useState("");

  const [waOn, setWaOn] = useState(false);
  const [waCred, setWaCred] = useState(watiCreds[0]?.id ?? "");
  const [waPhoneCol, setWaPhoneCol] = useState(selectedTable?.phone_column ?? "");
  const [waTemplate, setWaTemplate] = useState("");
  const [waSlots, setWaSlots] = useState("");
  const [waGoal, setWaGoal] = useState("");
  const [waMark, setWaMark] = useState("");

  const [updOn, setUpdOn] = useState(false);
  const [updCols, setUpdCols] = useState<string[]>([]);
  const [updGoal, setUpdGoal] = useState("");

  const [everyMinutes, setEveryMinutes] = useState(30);
  const [approvalMode, setApprovalMode] = useState<"auto" | "review">("review");
  const [active, setActive] = useState(false);

  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleUpdCol(key: string) {
    setUpdCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function buildPayload(): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
    if (!name.trim()) return { ok: false, error: "Give the workflow a name." };
    if (!agentId) return { ok: false, error: "Select a management agent." };
    if (!selectedTable) return { ok: false, error: "Select a table." };
    if (!emailOn && !waOn && !updOn) return { ok: false, error: "Enable at least one channel (email, WhatsApp, or row update)." };

    const filters: Array<{ column: string; op: string; value?: string }> = [];
    if (filterColumn && filterValue) filters.push({ column: filterColumn, op: "eq", value: filterValue });

    const steps: Record<string, unknown>[] = [];
    if (emailOn) {
      if (!emailCred) return { ok: false, error: "Email enabled: choose an SMTP connection (or add one in Connections)." };
      if (!emailToCol) return { ok: false, error: "Email enabled: choose the column containing the recipient email address." };
      steps.push({
        type: "ai_email",
        credential_id: emailCred,
        to: `{{${emailToCol}}}`,
        goal: emailGoal || undefined,
        skip_if_column: emailMark || undefined,
        mark_column: emailMark || undefined,
      });
    }
    if (waOn) {
      if (!waCred) return { ok: false, error: "WhatsApp enabled: choose a WATI connection." };
      if (!waPhoneCol) return { ok: false, error: "WhatsApp enabled: choose the phone column." };
      if (!waTemplate.trim()) return { ok: false, error: "WhatsApp enabled: enter the WATI template name." };
      const param_slots = waSlots
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => ({ name: s }));
      steps.push({
        type: "ai_whatsapp",
        credential_id: waCred,
        phone: `{{${waPhoneCol}}}`,
        template_name: waTemplate.trim(),
        param_slots,
        goal: waGoal || undefined,
        skip_if_column: waMark || undefined,
        mark_column: waMark || undefined,
      });
    }
    if (updOn) {
      if (updCols.length === 0) return { ok: false, error: "Row update enabled: choose at least one column." };
      steps.push({ type: "ai_update_row", columns: updCols, goal: updGoal || undefined });
    }

    return {
      ok: true,
      body: {
        name: name.trim(),
        description: description.trim() || null,
        agent_id: agentId,
        approval_mode: approvalMode,
        active,
        trigger: {
          type: "table_scan",
          every_minutes: everyMinutes,
          table: selectedTable.physical_table,
          filters,
          max_rows_per_run: 50,
        },
        steps,
      },
    };
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      router.push("/workflows");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create_failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    const built = buildPayload();
    if (!built.ok) {
      setError(built.error);
      return;
    }
    await post(built.body);
  }

  async function onCreateFromJson() {
    setError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setError("Invalid JSON.");
      return;
    }
    if (!parsed.trigger || !Array.isArray(parsed.steps)) {
      setError('JSON must contain at least "trigger" and "steps".');
      return;
    }
    // Fill missing binding fields from the form so the import is complete.
    const body: Record<string, unknown> = {
      name: (parsed.name as string) || name.trim() || "Imported workflow",
      description: (parsed.description as string) ?? (description.trim() || null),
      agent_id: (parsed.agent_id as string) || agentId || null,
      approval_mode: (parsed.approval_mode as string) || approvalMode,
      active: typeof parsed.active === "boolean" ? parsed.active : false,
      trigger: parsed.trigger,
      steps: parsed.steps,
    };
    await post(body);
  }

  if (agents.length === 0) {
    return (
      <section className="card">
        <p style={{ margin: 0 }}>
          No <strong>management agent</strong> available. Create one first:{" "}
          <Link href="/agents/new" style={{ color: "var(--accent)" }}>New agent → Management</Link>.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      {/* 1. Identity + agent + table */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>1. Which agent, on which table</h3>
        <div>
          <label>Workflow name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="No-show follow-ups" />
        </div>
        <div>
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this workflow does…" />
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Management agent *</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Contact table *</label>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">— Choose —</option>
              {dataTables.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        {selectedTable && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", alignItems: "end" }}>
            <div>
              <label>Only act when (optional)</label>
              <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)}>
                <option value="">— All records —</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>{c.label || c.key}</option>
                ))}
              </select>
            </div>
            <div>
              <label>… equals</label>
              <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="e.g. no-show" disabled={!filterColumn} />
            </div>
          </div>
        )}
      </section>

      {/* 2. Channels */}
      {selectedTable && (
        <section className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>2. What the agent does for each record</h3>

          {/* Email */}
          <ChannelBlock on={emailOn} setOn={setEmailOn} title="✉️ Send an email (drafted by the agent)">
            {smtpCreds.length === 0 ? (
              <NoCred kind="SMTP" />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Row>
                  <Field label="Email connection">
                    <select value={emailCred} onChange={(e) => setEmailCred(e.target.value)}>
                      {smtpCreds.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </Field>
                  <Field label="Recipient email column">
                    <select value={emailToCol} onChange={(e) => setEmailToCol(e.target.value)}>
                      <option value="">— Choose —</option>
                      {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                    </select>
                  </Field>
                </Row>
                <Field label="Goal / instructions (optional)">
                  <input value={emailGoal} onChange={(e) => setEmailGoal(e.target.value)} placeholder="Offer a new slot this week" />
                </Field>
                <Field label="«Already sent» column (dedup, optional)">
                  <select value={emailMark} onChange={(e) => setEmailMark(e.target.value)}>
                    <option value="">— None —</option>
                    {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                  </select>
                </Field>
              </div>
            )}
          </ChannelBlock>

          {/* WhatsApp */}
          <ChannelBlock on={waOn} setOn={setWaOn} title="💬 Send a WhatsApp (template, variables filled by the agent)">
            {watiCreds.length === 0 ? (
              <NoCred kind="WATI" />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Row>
                  <Field label="WhatsApp connection">
                    <select value={waCred} onChange={(e) => setWaCred(e.target.value)}>
                      {watiCreds.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </Field>
                  <Field label="Phone column">
                    <select value={waPhoneCol} onChange={(e) => setWaPhoneCol(e.target.value)}>
                      <option value="">— Choose —</option>
                      {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                    </select>
                  </Field>
                </Row>
                <Row>
                  <Field label="WATI template name">
                    <input value={waTemplate} onChange={(e) => setWaTemplate(e.target.value)} placeholder="appointment_reminder" />
                  </Field>
                  <Field label="Template variables (comma-separated)">
                    <input value={waSlots} onChange={(e) => setWaSlots(e.target.value)} placeholder="first_name, date" />
                  </Field>
                </Row>
                <Field label="Goal / instructions (optional)">
                  <input value={waGoal} onChange={(e) => setWaGoal(e.target.value)} placeholder="Warm tone, remind the benefit" />
                </Field>
                <Field label="«Already sent» column (optional)">
                  <select value={waMark} onChange={(e) => setWaMark(e.target.value)}>
                    <option value="">— None —</option>
                    {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                  </select>
                </Field>
              </div>
            )}
          </ChannelBlock>

          {/* Update row */}
          <ChannelBlock on={updOn} setOn={setUpdOn} title="✎ Update the record (values decided by the agent)">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label="Columns the agent can fill in">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {columns.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={updCols.includes(c.key) ? "" : "ghost"}
                      onClick={() => toggleUpdCol(c.key)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      {c.label || c.key}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Goal / instructions (optional)">
                <input value={updGoal} onChange={(e) => setUpdGoal(e.target.value)} placeholder="Set status based on outcome" />
              </Field>
            </div>
          </ChannelBlock>
        </section>
      )}

      {/* 3. Cadence + approval */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>3. Cadence &amp; approval</h3>
        <Row>
          <Field label="Frequency (minutes)">
            <input type="number" min={5} max={1440} value={everyMinutes} onChange={(e) => setEveryMinutes(Number(e.target.value) || 30)} />
          </Field>
          <Field label="Approval">
            <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as "auto" | "review")}>
              <option value="review">Draft → I approve before sending (recommended)</option>
              <option value="auto">Auto-send (no approval)</option>
            </select>
          </Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
          Activate immediately (otherwise created paused, activate from the list)
        </label>
      </section>

      {error && <div style={{ color: "var(--bad)", fontSize: 14 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create workflow"}
        </button>
        <button type="button" className="ghost" onClick={() => router.push("/workflows")} disabled={busy}>
          Cancel
        </button>
        <Link href="/workflows/connections" style={{ marginLeft: "auto" }}>
          <button type="button" className="ghost">⚙️ Manage connections</button>
        </Link>
      </div>

      {/* JSON import */}
      <section className="card">
        <button type="button" className="ghost" onClick={() => setShowJson((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "8px 12px" }}>
          {showJson ? "▾" : "▸"} Import from JSON (advanced)
        </button>
        {showJson && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Paste an automation JSON (at least <code>trigger</code> + <code>steps</code>). The agent and approval
              mode chosen above fill in anything missing.
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{ "name": "...", "trigger": { "type": "table_scan", ... }, "steps": [ ... ] }'
              style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
            <div>
              <button type="button" onClick={onCreateFromJson} disabled={busy || !jsonText.trim()}>
                Create from JSON
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ChannelBlock({ on, setOn, title, children }: { on: boolean; setOn: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: on ? "var(--accent-soft)" : "var(--bg-2)" }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, cursor: "pointer" }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} style={{ width: "auto" }} />
        {title}
      </label>
      {on && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12 }}>{label}</label>
      {children}
    </div>
  );
}

function NoCred({ kind }: { kind: string }) {
  return (
    <div className="muted" style={{ fontSize: 13 }}>
      No {kind} connection.{" "}
      <Link href="/workflows/connections" style={{ color: "var(--accent)" }}>Add one</Link> to enable this channel.
    </div>
  );
}
