"use client";

import { useEffect, useMemo, useState } from "react";

interface Secret {
  id: string;
  org_id: string;
  name: string;
  secret: string;
  campaign_id: string | null;
  enabled: boolean;
  created_at: string;
}

export function InboundConnectorsClient({
  orgId,
  campaigns,
}: {
  orgId: string;
  campaigns: Array<{ id: string; name: string }>;
}) {
  const [rows, setRows] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // new-secret form state
  const [newName, setNewName] = useState("");
  const [newCampaign, setNewCampaign] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") return "/api/leads/inbound";
    return `${window.location.origin}/api/leads/inbound`;
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/inbound-secrets?org_id=${orgId}`);
      if (!r.ok) throw new Error(await r.text());
      setRows((await r.json()) as Secret[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function createSecret() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/inbound-secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          name: newName.trim(),
          campaign_id: newCampaign || null,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setNewName("");
      setNewCampaign("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeSecret(id: string) {
    if (!confirm("Delete this connector? n8n webhooks will stop working.")) return;
    setError(null);
    try {
      const r = await fetch(`/api/admin/inbound-secrets?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  function campaignName(id: string | null): string {
    if (!id) return "(default: first active campaign in org)";
    return campaigns.find((c) => c.id === id)?.name ?? id;
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #b00020)", color: "var(--danger, #b00020)" }}>
          {error}
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Webhook URL</h2>
        <p className="subtitle" style={{ marginTop: 4 }}>
          All n8n integrations call this URL via POST with the connector secret in the body.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <code style={{ flex: 1, padding: "8px 10px", background: "var(--surface-2, #111)", borderRadius: 6 }}>
            {webhookUrl}
          </code>
          <button onClick={() => copy(webhookUrl, "url")} className="btn">
            {copied === "url" ? "Copied!" : "Copy URL"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Create a connector</h2>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 2fr auto" }}>
          <input
            type="text"
            placeholder="Name (e.g. Google Ads – September)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select value={newCampaign} onChange={(e) => setNewCampaign(e.target.value)}>
            <option value="">Default campaign (auto)</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={createSecret} disabled={busy || !newName.trim()} className="btn primary">
            {busy ? "…" : "Generate secret"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Connectors ({rows.length})</h2>
        {loading ? (
          <div className="subtitle">Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="subtitle" style={{ margin: 0 }}>
              No connectors yet.
            </div>
            <div className="subtitle" style={{ margin: 0, maxWidth: 560 }}>
              A connector generates a unique secret so an n8n workflow
              (Google Ads, Facebook Lead Ads, Google Sheets…) can push
              leads into this org.
            </div>
            <div>
              <button
                onClick={() => {
                  const el = document.querySelector<HTMLInputElement>(
                    "input[placeholder^=\"Name\"]",
                  );
                  el?.focus();
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                + Create a connector
              </button>
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted-2)", fontSize: 12 }}>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Campaign</th>
                <th style={{ padding: 8 }}>Secret</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border, #222)" }}>
                  <td style={{ padding: 8 }}>{s.name}</td>
                  <td style={{ padding: 8 }}>{campaignName(s.campaign_id)}</td>
                  <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>
                    <span title={s.secret}>{s.secret.slice(0, 8)}…{s.secret.slice(-4)}</span>
                  </td>
                  <td style={{ padding: 8, fontSize: 12, color: "var(--muted-2)" }}>
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: 8, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => copy(s.secret, `s-${s.id}`)} className="btn">
                      {copied === `s-${s.id}` ? "Copied!" : "Copy secret"}
                    </button>
                    <button
                      onClick={() => copy(
                        JSON.stringify({ url: webhookUrl, secret: s.secret }, null, 2),
                        `j-${s.id}`,
                      )}
                      className="btn"
                    >
                      {copied === `j-${s.id}` ? "Copied!" : "Copy (URL+secret JSON)"}
                    </button>
                    <button onClick={() => removeSecret(s.id)} className="btn danger">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Available n8n templates</h2>
        <ul style={{ lineHeight: 1.8 }}>
          <li>
            <code>n8n/templates/google-ads-lead-to-axon.json</code> — Google Ads Lead Form Extensions
          </li>
          <li>
            <code>n8n/templates/facebook-lead-ads-to-axon.json</code> — Facebook Lead Ads (with verify token)
          </li>
          <li>
            <code>n8n/templates/google-sheets-to-axon.json</code> — new row in Google Sheets (CSV)
          </li>
        </ul>
        <p className="subtitle">
          See <code>docs/CONNECTORS.md</code> for import instructions and n8n variable setup.
        </p>
      </section>
    </div>
  );
}
