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
      setErr("Donne un nom à cette connexion (ex. « Email OCC »).");
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
      setOk(`Connexion « ${name.trim()} » enregistrée.`);
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
        <h3 style={{ marginTop: 0 }}>Connexions enregistrées</h3>
        {creds.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aucune connexion. Ajoute ton email (SMTP) et/ou ton WhatsApp (WATI) ci-dessous —
            tes agents de gestion les utiliseront pour envoyer.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            {creds.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong> · {KIND_LABEL[c.kind] ?? c.kind}{" "}
                <span className="muted" style={{ fontSize: 12 }}>
                  ✓ {c.fields_set.length} champ{c.fields_set.length > 1 ? "s" : ""} configuré{c.fields_set.length > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Ajouter / mettre à jour une connexion</h3>
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
              <label>Nom de la connexion *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "smtp" ? "Email OCC" : "WhatsApp OCC"} />
            </div>
          </div>

          {kind === "smtp" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
                <div>
                  <label>Serveur SMTP</label>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div>
                  <label>Port</label>
                  <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="465" />
                </div>
              </div>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label>Identifiant (email)</label>
                  <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="contact@clinique.com" />
                </div>
                <div>
                  <label>Mot de passe (app password)</label>
                  <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
                </div>
              </div>
              <div>
                <label>Expéditeur affiché (optionnel)</label>
                <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Clinique OCC <contact@clinique.com>" />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label>URL de base WATI</label>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://live-server-xxxx.wati.io" />
              </div>
              <div>
                <label>Token WATI</label>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer eyJ…" />
              </div>
            </div>
          )}

          {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
          {ok && <div style={{ color: "var(--good)", fontSize: 13 }}>{ok}</div>}
          <div>
            <button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer la connexion"}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            🔒 Les secrets sont stockés côté serveur et ne sont jamais réaffichés. Pour les modifier,
            ré-enregistre la connexion sous le même nom.
          </div>
        </form>
      </section>
    </div>
  );
}
