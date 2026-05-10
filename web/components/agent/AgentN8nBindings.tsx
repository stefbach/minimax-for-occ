"use client";

import { useEffect, useState } from "react";
import type { AgentN8nWorkflow, N8nWorkflowSummary } from "@/lib/types";

export function AgentN8nBindings({ agentId }: { agentId: string }) {
  const [bindings, setBindings] = useState<AgentN8nWorkflow[]>([]);
  const [available, setAvailable] = useState<N8nWorkflowSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [b, a] = await Promise.all([
        fetch(`/api/agents/${agentId}/n8n`).then((r) => r.json()),
        fetch(`/api/n8n/workflows?active=true`).then((r) => r.json()),
      ]);
      setBindings(Array.isArray(b) ? b : []);
      setAvailable(Array.isArray(a) ? a : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, [agentId]);

  const boundPaths = new Set(bindings.map((b) => b.webhook_path));
  const candidates = available.filter((w) =>
    w.webhook_paths.some((p) => !boundPaths.has(p)),
  );

  async function bind(wf: N8nWorkflowSummary, webhookPath: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agents/${agentId}/n8n`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow_id: wf.id,
        workflow_name: wf.name,
        webhook_path: webhookPath,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "binding failed");
      return;
    }
    refresh();
  }

  async function unbind(b: AgentN8nWorkflow) {
    setBusy(true);
    const res = await fetch(`/api/agents/${agentId}/n8n?binding_id=${b.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) setError("unbind failed");
    refresh();
  }

  async function toggle(b: AgentN8nWorkflow) {
    setBusy(true);
    // The simplest path: rebind with enabled flipped.
    await fetch(`/api/agents/${agentId}/n8n`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow_id: b.workflow_id,
        workflow_name: b.workflow_name,
        webhook_path: b.webhook_path,
        description: b.description,
        enabled: !b.enabled,
      }),
    });
    setBusy(false);
    refresh();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Workflows accessibles à cet agent</h3>
          <button className="ghost" onClick={refresh} disabled={busy} style={{ padding: "6px 10px" }}>
            ↻ Rafraîchir
          </button>
        </div>
        {bindings.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
            Aucun workflow associé. Choisissez en bas dans « Workflows disponibles ».
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr><th>Nom</th><th>Webhook</th><th>État</th><th></th></tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.workflow_name}</td>
                  <td><span className="kbd">/{b.webhook_path}</span></td>
                  <td>
                    {b.enabled
                      ? <span className="tag good">activé</span>
                      : <span className="tag">désactivé</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="ghost" onClick={() => toggle(b)} disabled={busy} style={{ padding: "5px 9px", marginRight: 6 }}>
                      {b.enabled ? "Désactiver" : "Activer"}
                    </button>
                    <button className="danger" onClick={() => unbind(b)} disabled={busy} style={{ padding: "5px 9px" }}>
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Workflows n8n disponibles</h3>
        {candidates.length === 0 ? (
          <p className="muted">Aucun workflow n8n actif avec un webhook libre. Créez-en un (avec un nœud Webhook), activez-le, puis revenez ici.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {candidates.map((w) => (
              <div key={w.id} className="card" style={{ background: "var(--panel-2)", padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{w.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {w.tags.map((t) => <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {w.webhook_paths.filter((p) => !boundPaths.has(p)).map((p) => (
                      <button key={p} onClick={() => bind(w, p)} disabled={busy} className="subtle" style={{ padding: "5px 9px" }}>
                        + /{p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <div className="card" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>{error}</div>}
    </div>
  );
}
