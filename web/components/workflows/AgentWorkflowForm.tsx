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
    if (!name.trim()) return { ok: false, error: "Donne un nom au workflow." };
    if (!agentId) return { ok: false, error: "Choisis un agent de gestion." };
    if (!selectedTable) return { ok: false, error: "Choisis une table." };
    if (!emailOn && !waOn && !updOn) return { ok: false, error: "Active au moins un canal (email, WhatsApp ou mise à jour)." };

    const filters: Array<{ column: string; op: string; value?: string }> = [];
    if (filterColumn && filterValue) filters.push({ column: filterColumn, op: "eq", value: filterValue });

    const steps: Record<string, unknown>[] = [];
    if (emailOn) {
      if (!emailCred) return { ok: false, error: "Email activé : choisis une connexion SMTP (ou ajoute-en une dans Connexions)." };
      if (!emailToCol) return { ok: false, error: "Email activé : choisis la colonne contenant l'adresse email." };
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
      if (!waCred) return { ok: false, error: "WhatsApp activé : choisis une connexion WATI." };
      if (!waPhoneCol) return { ok: false, error: "WhatsApp activé : choisis la colonne téléphone." };
      if (!waTemplate.trim()) return { ok: false, error: "WhatsApp activé : indique le nom du template WATI." };
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
      if (updCols.length === 0) return { ok: false, error: "Mise à jour activée : choisis au moins une colonne." };
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
      setError("JSON invalide.");
      return;
    }
    if (!parsed.trigger || !Array.isArray(parsed.steps)) {
      setError("Le JSON doit contenir au moins « trigger » et « steps ».");
      return;
    }
    // Fill missing binding fields from the form so the import is complete.
    const body: Record<string, unknown> = {
      name: (parsed.name as string) || name.trim() || "Workflow importé",
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
          Aucun <strong>agent de gestion</strong> disponible. Crée-en un d&apos;abord :{" "}
          <Link href="/agents/new" style={{ color: "var(--accent)" }}>Nouvel agent → Gestion</Link>.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      {/* 1. Identité + agent + table */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>1. Quel agent, sur quelle table</h3>
        <div>
          <label>Nom du workflow *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Relances no-show" />
        </div>
        <div>
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce que fait ce workflow…" />
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Agent de gestion *</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Table de contacts *</label>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">— Choisir —</option>
              {dataTables.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        {selectedTable && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", alignItems: "end" }}>
            <div>
              <label>N&apos;agir que si (optionnel)</label>
              <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)}>
                <option value="">— Toutes les fiches —</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>{c.label || c.key}</option>
                ))}
              </select>
            </div>
            <div>
              <label>… est égal à</label>
              <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="ex. no-show" disabled={!filterColumn} />
            </div>
          </div>
        )}
      </section>

      {/* 2. Channels */}
      {selectedTable && (
        <section className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>2. Ce que l&apos;agent fait pour chaque fiche</h3>

          {/* Email */}
          <ChannelBlock on={emailOn} setOn={setEmailOn} title="✉️ Envoyer un email (rédigé par l'agent)">
            {smtpCreds.length === 0 ? (
              <NoCred kind="SMTP" />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Row>
                  <Field label="Connexion email">
                    <select value={emailCred} onChange={(e) => setEmailCred(e.target.value)}>
                      {smtpCreds.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </Field>
                  <Field label="Colonne email du destinataire">
                    <select value={emailToCol} onChange={(e) => setEmailToCol(e.target.value)}>
                      <option value="">— Choisir —</option>
                      {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                    </select>
                  </Field>
                </Row>
                <Field label="Objectif / consigne (optionnel)">
                  <input value={emailGoal} onChange={(e) => setEmailGoal(e.target.value)} placeholder="Proposer un nouveau créneau cette semaine" />
                </Field>
                <Field label="Colonne « déjà envoyé » (anti-doublon, optionnel)">
                  <select value={emailMark} onChange={(e) => setEmailMark(e.target.value)}>
                    <option value="">— Aucune —</option>
                    {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                  </select>
                </Field>
              </div>
            )}
          </ChannelBlock>

          {/* WhatsApp */}
          <ChannelBlock on={waOn} setOn={setWaOn} title="💬 Envoyer un WhatsApp (template, variables remplies par l'agent)">
            {watiCreds.length === 0 ? (
              <NoCred kind="WATI" />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Row>
                  <Field label="Connexion WhatsApp">
                    <select value={waCred} onChange={(e) => setWaCred(e.target.value)}>
                      {watiCreds.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </Field>
                  <Field label="Colonne téléphone">
                    <select value={waPhoneCol} onChange={(e) => setWaPhoneCol(e.target.value)}>
                      <option value="">— Choisir —</option>
                      {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                    </select>
                  </Field>
                </Row>
                <Row>
                  <Field label="Nom du template WATI">
                    <input value={waTemplate} onChange={(e) => setWaTemplate(e.target.value)} placeholder="relance_rdv" />
                  </Field>
                  <Field label="Variables du template (séparées par virgule)">
                    <input value={waSlots} onChange={(e) => setWaSlots(e.target.value)} placeholder="prenom, date" />
                  </Field>
                </Row>
                <Field label="Objectif / consigne (optionnel)">
                  <input value={waGoal} onChange={(e) => setWaGoal(e.target.value)} placeholder="Ton chaleureux, rappeler le bénéfice" />
                </Field>
                <Field label="Colonne « déjà envoyé » (optionnel)">
                  <select value={waMark} onChange={(e) => setWaMark(e.target.value)}>
                    <option value="">— Aucune —</option>
                    {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                  </select>
                </Field>
              </div>
            )}
          </ChannelBlock>

          {/* Update row */}
          <ChannelBlock on={updOn} setOn={setUpdOn} title="✎ Mettre à jour la fiche (valeurs décidées par l'agent)">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label="Colonnes que l'agent peut renseigner">
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
              <Field label="Objectif / consigne (optionnel)">
                <input value={updGoal} onChange={(e) => setUpdGoal(e.target.value)} placeholder="Marquer le statut selon l'issue" />
              </Field>
            </div>
          </ChannelBlock>
        </section>
      )}

      {/* 3. Cadence + approval */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>3. Rythme &amp; validation</h3>
        <Row>
          <Field label="Fréquence (minutes)">
            <input type="number" min={5} max={1440} value={everyMinutes} onChange={(e) => setEveryMinutes(Number(e.target.value) || 30)} />
          </Field>
          <Field label="Validation">
            <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as "auto" | "review")}>
              <option value="review">Brouillon → je valide avant envoi (recommandé)</option>
              <option value="auto">Envoi automatique (sans validation)</option>
            </select>
          </Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
          Activer tout de suite (sinon créé en pause, à activer depuis la liste)
        </label>
      </section>

      {error && <div style={{ color: "var(--bad)", fontSize: 14 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCreate} disabled={busy}>
          {busy ? "Création…" : "Créer le workflow"}
        </button>
        <button type="button" className="ghost" onClick={() => router.push("/workflows")} disabled={busy}>
          Annuler
        </button>
        <Link href="/workflows/connections" style={{ marginLeft: "auto" }}>
          <button type="button" className="ghost">⚙️ Gérer les connexions</button>
        </Link>
      </div>

      {/* JSON import */}
      <section className="card">
        <button type="button" className="ghost" onClick={() => setShowJson((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "8px 12px" }}>
          {showJson ? "▾" : "▸"} Importer depuis un JSON (avancé)
        </button>
        {showJson && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Colle un JSON d&apos;automation (au moins <code>trigger</code> + <code>steps</code>). L&apos;agent et le
              mode de validation choisis ci-dessus complètent ce qui manque.
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{ "name": "...", "trigger": { "type": "table_scan", ... }, "steps": [ ... ] }'
              style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
            <div>
              <button type="button" onClick={onCreateFromJson} disabled={busy || !jsonText.trim()}>
                Créer depuis le JSON
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
      Aucune connexion {kind}.{" "}
      <Link href="/workflows/connections" style={{ color: "var(--accent)" }}>Ajoute-en une</Link> pour activer ce canal.
    </div>
  );
}
