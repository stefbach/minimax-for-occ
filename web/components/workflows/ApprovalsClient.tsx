"use client";

import { useCallback, useEffect, useState } from "react";

interface ActionRow {
  id: string;
  workflow_id: string;
  workflow_name: string | null;
  channel: string;
  table_name: string;
  row_id: string;
  payload: Record<string, unknown>;
  status: string;
  error: string | null;
  created_at: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  email: "✉️ Email",
  whatsapp: "💬 WhatsApp",
  update_row: "✎ Mise à jour",
};

/**
 * Review queue: AI-drafted actions awaiting approval (review-mode workflows).
 * The reviewer reads what the agent wrote, then approves (sends) or rejects.
 */
export function ApprovalsClient() {
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/automations/actions?status=pending", { cache: "no-store" });
      const j = (await r.json()) as { actions?: ActionRow[]; error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setErr(null);
      setActions(j.actions ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch(`/api/automations/actions/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setActions((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "decide_failed");
    } finally {
      setBusy(null);
    }
  }

  if (err) return <div style={{ color: "var(--bad)" }}>{err}</div>;

  if (actions.length === 0) {
    return (
      <section className="card">
        <p style={{ margin: 0 }} className="muted">
          Rien à valider. Les actions rédigées par tes agents en mode « validation » apparaîtront ici.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 820 }}>
      {actions.map((a) => (
        <section key={a.id} className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>
              {CHANNEL_LABEL[a.channel] ?? a.channel}
              {a.workflow_name && <span className="muted" style={{ fontWeight: 400 }}> · {a.workflow_name}</span>}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>fiche {a.row_id}</span>
          </div>

          <ActionPreview channel={a.channel} payload={a.payload} />

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => decide(a.id, "approve")} disabled={busy === a.id}>
              {busy === a.id ? "…" : "✓ Approuver & envoyer"}
            </button>
            <button type="button" className="ghost" onClick={() => decide(a.id, "reject")} disabled={busy === a.id}>
              ✕ Rejeter
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

function ActionPreview({ channel, payload }: { channel: string; payload: Record<string, unknown> }) {
  if (channel === "email") {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <div className="muted">À : {String(payload.to ?? "—")}</div>
        <div><strong>{String(payload.subject ?? "(sans objet)")}</strong></div>
        <div
          style={{ marginTop: 6, padding: 10, background: "var(--bg-2)", borderRadius: 6, maxHeight: 220, overflow: "auto" }}
          dangerouslySetInnerHTML={{ __html: String(payload.html ?? "") }}
        />
      </div>
    );
  }
  if (channel === "whatsapp") {
    const params = Array.isArray(payload.parameters) ? (payload.parameters as Array<{ name: string; value: string }>) : [];
    return (
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <div className="muted">À : {String(payload.phone ?? "—")} · template {String(payload.template_name ?? "—")}</div>
        <ul style={{ margin: "6px 0 0 16px" }}>
          {params.map((p, i) => (
            <li key={i}><span className="muted">{p.name} :</span> {p.value}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (channel === "update_row") {
    const set = (payload.set ?? {}) as Record<string, unknown>;
    return (
      <div style={{ fontSize: 13 }}>
        <ul style={{ margin: "4px 0 0 16px" }}>
          {Object.entries(set).map(([k, v]) => (
            <li key={k}><span className="muted">{k} →</span> {String(v)}</li>
          ))}
        </ul>
      </div>
    );
  }
  return <pre style={{ fontSize: 12 }}>{JSON.stringify(payload, null, 2)}</pre>;
}
