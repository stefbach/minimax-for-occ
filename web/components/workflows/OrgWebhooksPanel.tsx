"use client";

import { useState } from "react";

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  event: string;
  data_table_id: string | null;
  watch_column: string;
  match_values: string[];
  active: boolean;
}

export interface DataTableOption {
  id: string;
  label: string;
}

export function OrgWebhooksPanel({
  initial,
  dataTables,
}: {
  initial: WebhookRow[];
  dataTables: DataTableOption[];
}) {
  const [rows, setRows] = useState<WebhookRow[]>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state.
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [watchColumn, setWatchColumn] = useState("qualification");
  const [matchValues, setMatchValues] = useState("");
  const [dataTableId, setDataTableId] = useState("");

  function reset() {
    setName("");
    setUrl("");
    setWatchColumn("qualification");
    setMatchValues("");
    setDataTableId("");
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          watch_column: watchColumn || "qualification",
          match_values: matchValues
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          data_table_id: dataTableId || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setRows((r) => [j as WebhookRow, ...r]);
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: WebhookRow) {
    const next = !row.active;
    setRows((r) => r.map((x) => (x.id === row.id ? { ...x, active: next } : x)));
    await fetch("/api/webhooks", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: row.id, active: next }),
    }).catch(() => {
      setRows((r) => r.map((x) => (x.id === row.id ? { ...x, active: row.active } : x)));
    });
  }

  async function remove(row: WebhookRow) {
    if (!confirm(`Delete webhook "${row.name}"?`)) return;
    setRows((r) => r.filter((x) => x.id !== row.id));
    await fetch(`/api/webhooks?id=${row.id}`, { method: "DELETE" }).catch(() => {});
  }

  const tableLabel = (id: string | null) =>
    id ? dataTables.find((dt) => dt.id === id)?.label ?? "Unknown table" : "All tables";

  return (
    <section style={{ marginBottom: 22 }}>
      <div className="page-header" style={{ marginTop: 0 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>Outgoing triggers (post-call)</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            When the agent records a qualification during a call, Axon calls the n8n webhook URL of your workflow (e.g. send an email + WhatsApp after an appointment).
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className={open ? "ghost" : undefined}>
          {open ? "Cancel" : "+ Add trigger"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", marginBottom: 10 }}>
          {error}
        </div>
      )}

      {open && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Email + WhatsApp post-appointment" />
            </div>
            <div>
              <label>n8n webhook URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://n8n…/webhook/post-appointment"
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}
              />
            </div>
            <div>
              <label>Watched column</label>
              <input value={watchColumn} onChange={(e) => setWatchColumn(e.target.value)} placeholder="qualification" />
            </div>
            <div>
              <label>Trigger values (comma-separated, empty = any value)</label>
              <input
                value={matchValues}
                onChange={(e) => setMatchValues(e.target.value)}
                placeholder="RDV CONFIRMÉ, RDV PROGRAMMÉ"
              />
            </div>
            <div>
              <label>Table</label>
              <select value={dataTableId} onChange={(e) => setDataTableId(e.target.value)}>
                <option value="">All tables</option>
                {dataTables.map((dt) => (
                  <option key={dt.id} value={dt.id}>{dt.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={create} disabled={busy || !name || !url}>
              {busy ? "Saving…" : "Save trigger"}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No triggers yet. Add one to link a qualification (e.g. appointment confirmed) to an n8n workflow.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Column</th>
                <th>Values</th>
                <th>Table</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{r.url}</div>
                  </td>
                  <td><span className="kbd">{r.watch_column}</span></td>
                  <td>
                    {r.match_values.length === 0
                      ? <span className="muted" style={{ fontSize: 12 }}>any value</span>
                      : r.match_values.map((v) => <span key={v} className="tag" style={{ marginRight: 4 }}>{v}</span>)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{tableLabel(r.data_table_id)}</td>
                  <td>
                    <button className="subtle" style={{ padding: "3px 8px" }} onClick={() => toggle(r)}>
                      {r.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="danger" style={{ padding: "3px 8px" }} onClick={() => remove(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
