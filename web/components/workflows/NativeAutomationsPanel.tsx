"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Wf {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger: { type: string; every_minutes?: number; table?: string };
  steps: Array<{ type: string }>;
  last_run_at: string | null;
  last_status: string | null;
  agent_id: string | null;
  agent_name: string | null;
  approval_mode: string | null;
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
  update_row: "✎ Mise à jour",
  ai_email: "✉️ Email (IA)",
  ai_whatsapp: "💬 WhatsApp (IA)",
  ai_update_row: "✎ Mise à jour (IA)",
};

const SUPPORTED_STEPS = new Set([
  "send_email_smtp",
  "send_wati_template",
  "update_row",
  "ai_email",
  "ai_whatsapp",
  "ai_update_row",
]);
const AI_STEPS = new Set(["ai_email", "ai_whatsapp", "ai_update_row"]);

/** Can the current engine actually run this workflow? Returns a reason if not. */
function runnableState(wf: Wf): { ok: boolean; reason?: string } {
  if (wf.trigger?.type !== "table_scan") {
    return { ok: false, reason: `déclencheur « ${wf.trigger?.type ?? "?"} » non géré` };
  }
  if (!wf.trigger?.table) return { ok: false, reason: "aucune table définie" };
  const types = (wf.steps ?? []).map((s) => s.type);
  if (types.length === 0) return { ok: false, reason: "aucune action définie" };
  const bad = Array.from(new Set(types.filter((t) => !SUPPORTED_STEPS.has(t))));
  if (bad.length > 0) return { ok: false, reason: `actions non gérées : ${bad.join(", ")}` };
  if (types.some((t) => AI_STEPS.has(t)) && !wf.agent_id) {
    return { ok: false, reason: "actions IA sans agent de gestion lié" };
  }
  return { ok: true };
}

function summarize(wf: Wf): string {
  const trig =
    wf.trigger?.type === "table_scan"
      ? `Toutes les ${wf.trigger.every_minutes ?? 5} min, sur « ${wf.trigger.table} »`
      : `Déclencheur : ${wf.trigger?.type ?? "?"}`;
  const acts = (wf.steps ?? []).map((s) => STEP_LABELS[s.type] ?? s.type).join(" + ");
  return `${trig} → ${acts || "aucune action"}`;
}

export function NativeAutomationsPanel() {
  const [wfs, setWfs] = useState<Wf[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

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

  const { operational, drafts } = useMemo(() => {
    const op: Wf[] = [];
    const dr: Wf[] = [];
    for (const w of wfs) (runnableState(w).ok ? op : dr).push(w);
    return { operational: op, drafts: dr };
  }, [wfs]);

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
          `« ${wf.name} » : ${j.matched ?? 0} fiche(s) trouvée(s) · ${j.actions ?? 0} action(s) · ${j.skipped ?? 0} ignorée(s) · ${j.errors ?? 0} erreur(s).`,
        );
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function Card({ wf }: { wf: Wf }) {
    const state = runnableState(wf);
    const wfRuns = runs.filter((r) => r.workflow_id === wf.id).slice(0, 3);
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderLeft: `3px solid ${state.ok ? (wf.active ? "var(--good)" : "var(--muted)") : "var(--warn, #d98a00)"}`,
          borderRadius: 8,
          padding: 12,
          display: "grid",
          gap: 8,
          opacity: state.ok ? 1 : 0.92,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ flex: "1 1 240px" }}>{wf.name}</strong>
          {state.ok ? (
            <span className="tag" style={{ fontSize: 11, background: "var(--good)", color: "#fff" }}>
              {wf.active ? "● Actif" : "○ En pause"}
            </span>
          ) : (
            <span className="tag" style={{ fontSize: 11, background: "var(--warn, #d98a00)", color: "#fff" }} title={state.reason}>
              ⚠️ Non exécutable
            </span>
          )}
        </div>

        <div style={{ fontSize: 13 }}>{summarize(wf)}</div>

        <div className="muted" style={{ fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {wf.agent_name && <span>🤖 Agent : <strong>{wf.agent_name}</strong></span>}
          {(wf.steps ?? []).some((s) => AI_STEPS.has(s.type)) && (
            <span>Validation : {wf.approval_mode === "review" ? "🛡️ brouillon à valider" : "⚡ envoi auto"}</span>
          )}
          <span>
            {wf.last_run_at
              ? `Dernier passage : ${new Date(wf.last_run_at).toLocaleString("fr-FR")} (${wf.last_status ?? "—"})`
              : "Jamais exécuté"}
          </span>
        </div>

        {!state.ok && (
          <div style={{ fontSize: 12, color: "var(--warn, #d98a00)" }}>
            Ce workflow ne peut pas tourner : {state.reason}. Crée plutôt un{" "}
            <Link href="/workflows/agent/new" style={{ color: "var(--accent)" }}>workflow IA</Link> via le formulaire guidé.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            disabled={busy === wf.id || !state.ok}
            onClick={() => toggle(wf)}
            title={!state.ok ? state.reason : undefined}
            style={{ padding: "6px 12px", fontWeight: 600 }}
          >
            {wf.active ? "Mettre en pause" : "Activer"}
          </button>
          <button
            className="ghost"
            disabled={busy === wf.id || !state.ok}
            onClick={() => runNow(wf)}
            title={!state.ok ? state.reason : "Lance un passage tout de suite (test)"}
            style={{ padding: "6px 12px" }}
          >
            {busy === wf.id ? "…" : "Tester maintenant"}
          </button>
          <Link href={`/workflows/automations/${wf.id}`}>
            <button className="ghost" style={{ padding: "6px 12px" }}>Détails (avancé)</button>
          </Link>
        </div>

        {wfRuns.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--muted)", display: "grid", gap: 2 }}>
            {wfRuns.map((r) => (
              <div key={r.id}>
                {new Date(r.started_at).toLocaleTimeString("fr-FR")} — {r.status} · {r.matched} fiche(s) · {r.actions} action(s) · {r.errors} erreur(s)
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Guidance + CTA */}
      <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Workflows IA</h3>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          Un workflow fait travailler un <strong>agent de gestion</strong> sur une table : il rédige et envoie
          des relances (email / WhatsApp) ou met à jour les fiches, automatiquement. En 3 étapes :
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li><Link href="/agents/new" style={{ color: "var(--accent)" }}>Créer un agent de gestion</Link> (son rôle, son ton).</li>
          <li><Link href="/workflows/connections" style={{ color: "var(--accent)" }}>Saisir tes connexions</Link> email (SMTP) et WhatsApp (WATI).</li>
          <li><Link href="/workflows/agent/new" style={{ color: "var(--accent)" }}>Créer un workflow IA</Link> : agent + table + canal + rythme. (L&apos;import JSON est dans ce formulaire, section « avancé ».)</li>
        </ol>
        <div>
          <Link href="/workflows/agent/new"><button style={{ padding: "8px 16px" }}>+ Créer un workflow IA</button></Link>
        </div>
      </div>

      {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      {runResult && (
        <div className="card" style={{ padding: 10, color: "var(--good)", fontSize: 13 }}>{runResult}</div>
      )}

      {/* Operational workflows */}
      <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Mes workflows ({operational.length})</h3>
          <span className="muted" style={{ fontSize: 12 }}>Cron toutes les 5 min</span>
        </div>
        {operational.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Aucun workflow opérationnel pour l&apos;instant. Clique « + Créer un workflow IA » ci-dessus pour démarrer.
          </div>
        ) : (
          operational.map((wf) => <Card key={wf.id} wf={wf} />)
        )}
      </div>

      {/* Non-runnable drafts (legacy/aspirational), de-emphasised */}
      {drafts.length > 0 && (
        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <button
            type="button"
            className="ghost"
            onClick={() => setShowDrafts((v) => !v)}
            style={{ width: "100%", textAlign: "left", padding: "8px 10px", display: "flex", justifyContent: "space-between" }}
          >
            <span>{showDrafts ? "▾" : "▸"} Brouillons non exécutables ({drafts.length})</span>
            <span className="muted" style={{ fontSize: 12 }}>conçus pour un moteur à venir — n&apos;agissent pas</span>
          </button>
          {showDrafts && drafts.map((wf) => <Card key={wf.id} wf={wf} />)}
        </div>
      )}
    </div>
  );
}
