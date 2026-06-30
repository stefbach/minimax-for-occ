"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n";

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
  const t = useT();
  const router = useRouter();
  const smtpCreds = credentials.filter((c) => c.kind === "smtp");
  const watiCreds = credentials.filter((c) => c.kind === "wati");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [tableId, setTableId] = useState(dataTables[0]?.id ?? "");
  const selectedTable = useMemo(
    () => dataTables.find((tbl) => tbl.id === tableId) ?? null,
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
    if (!name.trim()) return { ok: false, error: t("Donnez un nom au workflow.") };
    if (!agentId) return { ok: false, error: t("Sélectionnez un agent de gestion.") };
    if (!selectedTable) return { ok: false, error: t("Sélectionnez une table.") };
    if (!emailOn && !waOn && !updOn) return { ok: false, error: t("Activez au moins un canal (email, WhatsApp ou mise à jour de ligne).") };

    const filters: Array<{ column: string; op: string; value?: string }> = [];
    if (filterColumn && filterValue) filters.push({ column: filterColumn, op: "eq", value: filterValue });

    const steps: Record<string, unknown>[] = [];
    if (emailOn) {
      if (!emailCred) return { ok: false, error: t("Email activé : choisissez une connexion SMTP (ou ajoutez-en une dans Connexions).") };
      if (!emailToCol) return { ok: false, error: t("Email activé : choisissez la colonne contenant l'adresse email du destinataire.") };
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
      if (!waCred) return { ok: false, error: t("WhatsApp activé : choisissez une connexion WATI.") };
      if (!waPhoneCol) return { ok: false, error: t("WhatsApp activé : choisissez la colonne téléphone.") };
      if (!waTemplate.trim()) return { ok: false, error: t("WhatsApp activé : saisissez le nom du template WATI.") };
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
      if (updCols.length === 0) return { ok: false, error: t("Mise à jour activée : choisissez au moins une colonne.") };
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
      setError(t("JSON invalide."));
      return;
    }
    if (!parsed.trigger || !Array.isArray(parsed.steps)) {
      setError(t('Le JSON doit contenir au moins "trigger" et "steps".'));
      return;
    }
    // Fill missing binding fields from the form so the import is complete.
    const body: Record<string, unknown> = {
      name: (parsed.name as string) || name.trim() || t("Workflow importé"),
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
          {t("Aucun")} <strong>{t("agent de gestion")}</strong> {t("disponible. Créez-en un d'abord :")}{" "}
          <Link href="/agents/new" style={{ color: "var(--accent)" }}>{t("Nouvel agent → Gestion")}</Link>.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      {/* 1. Identity + agent + table */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>1. {t("Quel agent, sur quelle table")}</h3>
        <div>
          <label>{t("Nom du workflow")} *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Relances no-show")} />
        </div>
        <div>
          <label>{t("Description")}</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Ce que fait ce workflow…")} />
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>{t("Agent de gestion")} *</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t("Table de contacts")} *</label>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">{t("— Choisir —")}</option>
              {dataTables.map((tbl) => (
                <option key={tbl.id} value={tbl.id}>{tbl.label}</option>
              ))}
            </select>
          </div>
        </div>
        {selectedTable && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", alignItems: "end" }}>
            <div>
              <label>{t("N'agir que si (optionnel)")}</label>
              <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)}>
                <option value="">{t("— Tous les enregistrements —")}</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>{c.label || c.key}</option>
                ))}
              </select>
            </div>
            <div>
              <label>… {t("est égal à")}</label>
              <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder={t("ex. no-show")} disabled={!filterColumn} />
            </div>
          </div>
        )}
      </section>

      {/* 2. Channels */}
      {selectedTable && (
        <section className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>2. {t("Ce que l'agent fait pour chaque enregistrement")}</h3>

          {/* Email */}
          <ChannelBlock on={emailOn} setOn={setEmailOn} title={"✉️ " + t("Envoyer un email (rédigé par l'agent)")}>
            {smtpCreds.length === 0 ? (
              <NoCred kind="SMTP" />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Row>
                  <Field label={t("Connexion email")}>
                    <select value={emailCred} onChange={(e) => setEmailCred(e.target.value)}>
                      {smtpCreds.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </Field>
                  <Field label={t("Colonne email destinataire")}>
                    <select value={emailToCol} onChange={(e) => setEmailToCol(e.target.value)}>
                      <option value="">{t("— Choisir —")}</option>
                      {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                    </select>
                  </Field>
                </Row>
                <Field label={t("Objectif / instructions (optionnel)")}>
                  <input value={emailGoal} onChange={(e) => setEmailGoal(e.target.value)} placeholder={t("Proposer un nouveau créneau cette semaine")} />
                </Field>
                <Field label={t("Colonne «Déjà envoyé» (dédup, optionnel)")}>
                  <select value={emailMark} onChange={(e) => setEmailMark(e.target.value)}>
                    <option value="">{t("— Aucune —")}</option>
                    {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                  </select>
                </Field>
              </div>
            )}
          </ChannelBlock>

          {/* WhatsApp */}
          <ChannelBlock on={waOn} setOn={setWaOn} title={"💬 " + t("Envoyer un WhatsApp (template, variables remplies par l'agent)")}>
            {watiCreds.length === 0 ? (
              <NoCred kind="WATI" />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Row>
                  <Field label={t("Connexion WhatsApp")}>
                    <select value={waCred} onChange={(e) => setWaCred(e.target.value)}>
                      {watiCreds.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </Field>
                  <Field label={t("Colonne téléphone")}>
                    <select value={waPhoneCol} onChange={(e) => setWaPhoneCol(e.target.value)}>
                      <option value="">{t("— Choisir —")}</option>
                      {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                    </select>
                  </Field>
                </Row>
                <Row>
                  <Field label={t("Nom du template WATI")}>
                    <input value={waTemplate} onChange={(e) => setWaTemplate(e.target.value)} placeholder="appointment_reminder" />
                  </Field>
                  <Field label={t("Variables du template (séparées par virgule)")}>
                    <input value={waSlots} onChange={(e) => setWaSlots(e.target.value)} placeholder="first_name, date" />
                  </Field>
                </Row>
                <Field label={t("Objectif / instructions (optionnel)")}>
                  <input value={waGoal} onChange={(e) => setWaGoal(e.target.value)} placeholder={t("Ton chaleureux, rappeler le bénéfice")} />
                </Field>
                <Field label={t("Colonne «Déjà envoyé» (optionnel)")}>
                  <select value={waMark} onChange={(e) => setWaMark(e.target.value)}>
                    <option value="">{t("— Aucune —")}</option>
                    {columns.map((c) => (<option key={c.key} value={c.key}>{c.label || c.key}</option>))}
                  </select>
                </Field>
              </div>
            )}
          </ChannelBlock>

          {/* Update row */}
          <ChannelBlock on={updOn} setOn={setUpdOn} title={"✎ " + t("Mettre à jour l'enregistrement (valeurs décidées par l'agent)")}>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={t("Colonnes que l'agent peut remplir")}>
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
              <Field label={t("Objectif / instructions (optionnel)")}>
                <input value={updGoal} onChange={(e) => setUpdGoal(e.target.value)} placeholder={t("Définir le statut selon le résultat")} />
              </Field>
            </div>
          </ChannelBlock>
        </section>
      )}

      {/* 3. Cadence + approval */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>3. {t("Cadence & approbation")}</h3>
        <Row>
          <Field label={t("Fréquence (minutes)")}>
            <input type="number" min={5} max={1440} value={everyMinutes} onChange={(e) => setEveryMinutes(Number(e.target.value) || 30)} />
          </Field>
          <Field label={t("Approbation")}>
            <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as "auto" | "review")}>
              <option value="review">{t("Brouillon → j'approuve avant envoi (recommandé)")}</option>
              <option value="auto">{t("Envoi automatique (sans approbation)")}</option>
            </select>
          </Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
          {t("Activer immédiatement (sinon créé en pause, activez depuis la liste)")}
        </label>
      </section>

      {error && <div style={{ color: "var(--bad)", fontSize: 14 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCreate} disabled={busy}>
          {busy ? t("Création…") : t("Créer le workflow")}
        </button>
        <button type="button" className="ghost" onClick={() => router.push("/workflows")} disabled={busy}>
          {t("Annuler")}
        </button>
        <Link href="/workflows/connections" style={{ marginLeft: "auto" }}>
          <button type="button" className="ghost">⚙️ {t("Gérer les connexions")}</button>
        </Link>
      </div>

      {/* JSON import */}
      <section className="card">
        <button type="button" className="ghost" onClick={() => setShowJson((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "8px 12px" }}>
          {showJson ? "▾" : "▸"} {t("Importer depuis JSON (avancé)")}
        </button>
        {showJson && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {t("Collez un JSON d'automation (au moins")} <code>trigger</code> + <code>steps</code>). {t("L'agent et le mode d'approbation choisis ci-dessus complètent ce qui manque.")}
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{ "name": "...", "trigger": { "type": "table_scan", ... }, "steps": [ ... ] }'
              style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
            <div>
              <button type="button" onClick={onCreateFromJson} disabled={busy || !jsonText.trim()}>
                {t("Créer depuis JSON")}
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
  const t = useT();
  return (
    <div className="muted" style={{ fontSize: 13 }}>
      {t("Aucune connexion")} {kind}.{" "}
      <Link href="/workflows/connections" style={{ color: "var(--accent)" }}>{t("Ajoutez-en une")}</Link> {t("pour activer ce canal.")}
    </div>
  );
}
