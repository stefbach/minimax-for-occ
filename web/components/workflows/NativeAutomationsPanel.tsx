"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

interface Wf {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger: { type: string; every_minutes?: number; table?: string };
  steps: Array<{ type: string }>;
  last_run_at: string | null;
  last_status: string | null;
  group_label: string | null;
  sort_order: number | null;
}

interface Run {
  id: string;
  workflow_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  matched: number;
  actions: number;
  skipped: number;
  errors: number;
}

const STEP_LABELS: Record<string, string> = {
  send_email_smtp: "✉️ Email",
  send_wati_template: "💬 WhatsApp",
  send_whatsapp_session: "💬 WA session",
  update_row: "✎ MAJ ligne",
  ai_brain: "🧠 IA",
  telegram_notify: "📣 Telegram",
  http_request: "🌐 HTTP",
  call_automation: "🔗 Sous-agent",
  gmail_search: "📥 Gmail",
  classify_document_ai: "🧠 Classer doc",
  storage_upload: "📤 Stockage",
  upsert_nhs_document: "🗂 Document",
  screen_dossier: "📊 Screening",
  ai_agent_tools: "🧠 Agent+outils",
  generate_document_ai: "🧠 Génération doc",
  render_pdf: "📄 PDF",
  extract_clinical_ai: "🧠 Extraction",
  draft_gmail: "✉️ Brouillon",
  send_gmail: "✉️ Gmail",
};

export function NativeAutomationsPanel() {
  const t = useT();
  const [wfs, setWfs] = useState<Wf[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/automations", { cache: "no-store" });
      const j = (await r.json()) as { workflows?: Wf[]; runs?: Run[]; error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setErr(null);
      setWfs(j.workflows ?? []);
      setRuns(j.runs ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(wf: Wf) {
    setBusy(wf.id);
    setErr(null);
    try {
      const r = await fetch(`/api/automations/${wf.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !wf.active }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${r.status}`);
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function runNow(wf: Wf) {
    setBusy(wf.id);
    setErr(null);
    setRunResult(null);
    try {
      const r = await fetch(`/api/automations/${wf.id}/run`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as {
        matched?: number; actions?: number; skipped?: number; errors?: number; error?: string;
      };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
      } else {
        setRunResult(
          `${wf.name}: ${j.matched ?? 0} ${t("lignes trouvées")} · ${j.actions ?? 0} ${t("actions")} · ${j.skipped ?? 0} ${t("ignorées")} · ${j.errors ?? 0} ${t("erreurs")}`,
        );
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function renderCard(wf: Wf, step?: number) {
    const wfRuns = runs.filter((r) => r.workflow_id === wf.id).slice(0, 5);
    return (
      <div
        key={wf.id}
        style={{
          border: "1px solid var(--border)",
          borderLeft: `3px solid ${wf.active ? "var(--good)" : "var(--muted)"}`,
          borderRadius: 8,
          padding: 12,
          display: "grid",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {typeof step === "number" && (
            <span
              className="tag"
              style={{ fontSize: 11, fontWeight: 700, background: "var(--border)" }}
              title={t("Ordre d'exécution dans le pipeline")}
            >
              {step}
            </span>
          )}
          <strong style={{ flex: "1 1 240px" }}>{wf.name}</strong>
          <span className="tag" style={{ fontSize: 11 }}>
            {wf.trigger?.type === "table_scan"
              ? `⏱ ${wf.trigger.every_minutes ?? 5} min · ${wf.trigger.table}`
              : wf.trigger?.type === "callable"
                ? "🔗 sous-agent"
                : wf.trigger?.type}
          </span>
          {wf.steps.map((s, i) => (
            <span key={i} className="tag" style={{ fontSize: 11 }}>
              {STEP_LABELS[s.type] ?? s.type}
            </span>
          ))}
        </div>
        {wf.description && <div className="muted" style={{ fontSize: 12 }}>{wf.description}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button disabled={busy === wf.id} onClick={() => toggle(wf)} style={{ padding: "6px 12px", fontWeight: 600 }}>
            {wf.active ? t("Désactiver") : t("Activer")}
          </button>
          <button className="ghost" disabled={busy === wf.id} onClick={() => runNow(wf)} style={{ padding: "6px 12px" }}>
            {busy === wf.id ? "…" : t("Exécuter maintenant")}
          </button>
          <a href={`/workflows/automations/${wf.id}`}>
            <button className="ghost" style={{ padding: "6px 12px" }}>{t("Ouvrir / Éditer")}</button>
          </a>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
            {wf.last_run_at
              ? `${t("Dernier run")}: ${new Date(wf.last_run_at).toLocaleString("fr-FR")} (${wf.last_status ?? "—"})`
              : t("Jamais exécuté")}
          </span>
        </div>
        {wfRuns.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--muted)", display: "grid", gap: 2 }}>
            {wfRuns.map((r) => (
              <div key={r.id}>
                {new Date(r.started_at).toLocaleTimeString("fr-FR")} — {r.status} · {r.matched} {t("lignes")} ·{" "}
                {r.actions} {t("actions")} · {r.skipped} {t("ignorées")} · {r.errors} {t("erreurs")}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Group by group_label (preserving the API's sort order); number the
  // sub-agents so their execution order (2,3,5,7,6,4) is explicit.
  const groups: Array<{ label: string; items: Wf[] }> = [];
  const groupIndex = new Map<string, number>();
  for (const wf of wfs) {
    const label =
      wf.group_label ||
      (wf.trigger?.type === "table_scan"
        ? t("Déclencheurs automatiques (CRON)")
        : wf.trigger?.type === "callable"
          ? t("Sous-agents du pipeline (appelés par l'orchestrateur)")
          : t("Automations"));
    let i = groupIndex.get(label);
    if (i === undefined) {
      i = groups.length;
      groupIndex.set(label, i);
      groups.push({ label, items: [] });
    }
    groups[i].items.push(wf);
  }

  return (
    <div className="card" style={{ display: "grid", gap: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{t("Automations natives")}</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {t("Cron toutes les 5 min · credentials gérés côté serveur")}
        </span>
      </div>

      {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      {runResult && <div style={{ color: "var(--good)", fontSize: 13 }}>{runResult}</div>}

      {wfs.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          {t("Aucune automation. Le workflow seedé apparaîtra ici après le déploiement.")}
        </div>
      ) : (
        groups.map((group) => {
          const isSubAgents = group.items.every((w) => w.trigger?.type === "callable");
          return (
            <div key={group.label} style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  color: "var(--muted)",
                  marginTop: 6,
                  borderTop: "1px solid var(--border)",
                  paddingTop: 10,
                }}
              >
                {group.label}
              </div>
              {group.items.map((wf, idx) => renderCard(wf, isSubAgents ? idx + 1 : undefined))}
            </div>
          );
        })
      )}
    </div>
  );
}
