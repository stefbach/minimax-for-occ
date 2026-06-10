"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

interface Wf {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger: Record<string, unknown>;
  steps: unknown[];
  last_run_at: string | null;
  last_status: string | null;
}

interface CredentialInfo {
  id: string;
  name: string;
  kind: string;
  fields_set: string[];
}

/**
 * Editor for one native automation. Pragmatic first version: name /
 * description / active as form fields, trigger & steps as validated JSON
 * editors (the visual step builder comes later). Credentials are listed
 * read-only so the operator can copy ids into steps.
 */
export function AutomationEditor({ id }: { id: string }) {
  const t = useT();
  const [wf, setWf] = useState<Wf | null>(null);
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerJson, setTriggerJson] = useState("");
  const [stepsJson, setStepsJson] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [wr, cr] = await Promise.all([
        fetch("/api/automations", { cache: "no-store" }),
        fetch("/api/automations/credentials", { cache: "no-store" }),
      ]);
      const wj = (await wr.json()) as { workflows?: Wf[]; error?: string };
      if (!wr.ok) {
        setErr(wj.error ?? `HTTP ${wr.status}`);
        return;
      }
      const found = (wj.workflows ?? []).find((w) => w.id === id) ?? null;
      if (!found) {
        setErr(t("Automation introuvable."));
        return;
      }
      setWf(found);
      setName(found.name);
      setDescription(found.description ?? "");
      setTriggerJson(JSON.stringify(found.trigger, null, 2));
      setStepsJson(JSON.stringify(found.steps, null, 2));
      if (cr.ok) {
        const cj = (await cr.json()) as { credentials?: CredentialInfo[] };
        setCreds(cj.credentials ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setErr(null);
    setSaved(null);
    let trigger: unknown;
    let steps: unknown;
    try {
      trigger = JSON.parse(triggerJson);
    } catch {
      setErr(t("Le JSON du déclencheur est invalide."));
      return;
    }
    try {
      steps = JSON.parse(stepsJson);
      if (!Array.isArray(steps)) throw new Error();
    } catch {
      setErr(t("Le JSON des étapes est invalide (tableau attendu)."));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, trigger, steps }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setSaved(t("Enregistré."));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (err && !wf) {
    return (
      <div className="card" style={{ borderColor: "var(--bad)" }}>
        <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>
        <Link href="/workflows">← {t("Retour")}</Link>
      </div>
    );
  }
  if (!wf) {
    return <div className="card muted">{t("Chargement…")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <div className="card" style={{ display: "grid", gap: 10, padding: 14 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Nom")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 8 }} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Description")}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ padding: 8, fontFamily: "inherit" }}
          />
        </label>
      </div>

      <div className="card" style={{ display: "grid", gap: 8, padding: 14 }}>
        <strong style={{ fontSize: 14 }}>{t("Déclencheur")} (JSON)</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {t("type table_scan · every_minutes · table · filters [{column, op, value}] · max_rows_per_run")}
        </span>
        <textarea
          value={triggerJson}
          onChange={(e) => setTriggerJson(e.target.value)}
          rows={10}
          spellCheck={false}
          style={{ padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5 }}
        />
      </div>

      <div className="card" style={{ display: "grid", gap: 8, padding: 14 }}>
        <strong style={{ fontSize: 14 }}>{t("Étapes")} (JSON)</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {t("send_email_smtp · send_wati_template · update_row — modèles {{colonne}} acceptés")}
        </span>
        <textarea
          value={stepsJson}
          onChange={(e) => setStepsJson(e.target.value)}
          rows={18}
          spellCheck={false}
          style={{ padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5 }}
        />
      </div>

      <div className="card" style={{ display: "grid", gap: 6, padding: 14 }}>
        <strong style={{ fontSize: 14 }}>{t("Credentials disponibles")}</strong>
        {creds.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>{t("Aucun credential.")}</span>
        ) : (
          creds.map((c) => (
            <div key={c.id} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="tag">{c.kind}</span>
              <strong>{c.name}</strong>
              <span className="kbd" style={{ fontSize: 11 }}>{c.id}</span>
              <span className="muted">
                {t("champs renseignés")}: {c.fields_set.length > 0 ? c.fields_set.join(", ") : t("aucun")}
              </span>
            </div>
          ))
        )}
      </div>

      {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      {saved && <div style={{ color: "var(--good)", fontSize: 13 }}>{saved}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={save} style={{ padding: "8px 16px", fontWeight: 600 }}>
          {busy ? "…" : t("Enregistrer")}
        </button>
        <Link href="/workflows">
          <button className="ghost" style={{ padding: "8px 16px" }}>{t("Retour")}</button>
        </Link>
      </div>
    </div>
  );
}
