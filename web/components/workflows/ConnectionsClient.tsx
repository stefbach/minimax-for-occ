"use client";

import { useCallback, useEffect, useState } from "react";

interface Credential {
  id: string;
  name: string;
  kind: string;
  fields_set: string[];
}

const KIND_LABEL: Record<string, string> = {
  smtp: "✉️ Email (SMTP)",
  wati: "💬 WhatsApp (WATI)",
  http_bearer: "🔗 HTTP (token)",
};

/**
 * Org-level connections (credentials) used by automation workflows. Secrets are
 * write-only: once saved, the API only confirms which fields are set — they're
 * never sent back to the browser.
 */
export function ConnectionsClient() {
  const [creds, setCreds] = useState<Credential[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form
  const [kind, setKind] = useState<"smtp" | "wati">("smtp");
  const [name, setName] = useState("");
  // SMTP fields
  const [host, setHost] = useState("smtp.gmail.com");
  const [port, setPort] = useState("465");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  // WATI fields
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/automations/credentials", { cache: "no-store" });
      const j = (await r.json()) as { credentials?: Credential[]; error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setErr(null);
      setCreds(j.credentials ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    if (!name.trim()) {
      setErr('Give this connection a name (e.g. "Email OCC").');
      return;
    }
    const data =
      kind === "smtp"
        ? { host, port: Number(port) || 465, user, pass, from: from || user }
        : { base_url: baseUrl, token };
    setBusy(true);
    try {
      const r = await fetch("/api/automations/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, data }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setOk(`Connection "${name.trim()}" saved.`);
      setPass("");
      setToken("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Saved connections</h3>
        {creds.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No connections yet. Add your email (SMTP) and/or WhatsApp (WATI) below —
            your management agents will use them to send messages.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            {creds.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong> · {KIND_LABEL[c.kind] ?? c.kind}{" "}
                <span className="muted" style={{ fontSize: 12 }}>
                  ✓ {c.fields_set.length} field{c.fields_set.length > 1 ? "s" : ""} configured
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Add / update a connection</h3>
        <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Type</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as "smtp" | "wati")}>
                <option value="smtp">✉️ Email (SMTP)</option>
                <option value="wati">💬 WhatsApp (WATI)</option>
              </select>
            </div>
            <div>
              <label>Connection name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "smtp" ? "Email OCC" : "WhatsApp OCC"} />
            </div>
          </div>

          {kind === "smtp" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
                <div>
                  <label>SMTP server</label>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div>
                  <label>Port</label>
                  <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="465" />
                </div>
              </div>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label>Username (email)</label>
                  <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="contact@clinic.com" />
                </div>
                <div>
                  <label>Password (app password)</label>
                  <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
                </div>
              </div>
              <div>
                <label>Display sender (optional)</label>
                <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="OCC Clinic <contact@clinic.com>" />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label>WATI base URL</label>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://live-server-xxxx.wati.io" />
              </div>
              <div>
                <label>WATI token</label>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer eyJ…" />
              </div>
            </div>
          )}

          {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
          {ok && <div style={{ color: "var(--good)", fontSize: 13 }}>{ok}</div>}
          <div>
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save connection"}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            🔒 Secrets are stored server-side and never shown again. To update them,
            re-save the connection under the same name.
          </div>
        </form>
      </section>
    </div>
  );
}
