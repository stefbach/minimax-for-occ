"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

interface CredentialInfo {
  id: string;
  name: string;
  kind: string;
  fields_set: string[];
}

/** Field blueprints per credential kind — labels only, never values back out. */
const KIND_FIELDS: Record<string, { fields: Array<{ key: string; label: string; secret?: boolean }>; hint: string }> = {
  supabase_data: {
    hint: "Patient pipeline DB (leads_rdv, nhs_dossiers, nhs_documents, storage).",
    fields: [
      { key: "url", label: "Project URL (https://xxxx.supabase.co)" },
      { key: "service_key", label: "Service role key", secret: true },
    ],
  },
  anthropic: {
    hint: "Powers every automation's AI brain.",
    fields: [
      { key: "api_key", label: "Anthropic API key", secret: true },
      { key: "default_model", label: "Default model (optional)" },
    ],
  },
  gmail_oauth: {
    hint: "Read inboxes + send/draft emails (Stormi, Customer Service, Dr Nedelcu).",
    fields: [
      { key: "client_id", label: "OAuth client id" },
      { key: "client_secret", label: "OAuth client secret", secret: true },
      { key: "refresh_token", label: "Refresh token", secret: true },
      { key: "sender", label: "Sender email (optional)" },
    ],
  },
  wati: {
    hint: "WhatsApp templates + session messages.",
    fields: [
      { key: "base_url", label: "Base URL (https://live-mt-server.wati.io/NNNNNN)" },
      { key: "token", label: "Bearer token", secret: true },
    ],
  },
  smtp: {
    hint: "Send email over SMTP.",
    fields: [
      { key: "host", label: "Host" },
      { key: "port", label: "Port" },
      { key: "user", label: "User" },
      { key: "pass", label: "Password", secret: true },
      { key: "from", label: "From address" },
    ],
  },
  telegram: {
    hint: "Monitoring / QA notifications.",
    fields: [
      { key: "bot_token", label: "Bot token", secret: true },
      { key: "chat_id", label: "Default chat id" },
    ],
  },
  http_bearer: {
    hint: "Generic bearer-token HTTP auth.",
    fields: [{ key: "token", label: "Token", secret: true }],
  },
};

export function CredentialsPanel() {
  const t = useT();
  const [creds, setCreds] = useState<CredentialInfo[]>([]);
  const [kind, setKind] = useState<string>("anthropic");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/automations/credentials", { cache: "no-store" });
      const j = (await r.json()) as { credentials?: CredentialInfo[]; error?: string };
      if (r.ok) setCreds(j.credentials ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    setErr(null);
    setOk(null);
    if (!name.trim()) {
      setErr(t("Nom requis."));
      return;
    }
    const data: Record<string, string> = {};
    for (const f of KIND_FIELDS[kind].fields) {
      if (values[f.key]?.trim()) data[f.key] = values[f.key].trim();
    }
    setBusy(true);
    try {
      const r = await fetch("/api/automations/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, data }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setOk(t("Credential enregistré."));
      setName("");
      setValues({});
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const blueprint = KIND_FIELDS[kind];

  return (
    <div className="card" style={{ display: "grid", gap: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{t("Credentials")}</h3>
        <button className="ghost" onClick={() => setOpen((v) => !v)} style={{ padding: "6px 12px" }}>
          {open ? t("Fermer") : t("+ Ajouter / mettre à jour")}
        </button>
      </div>

      {creds.length === 0 ? (
        <span className="muted" style={{ fontSize: 12 }}>{t("Aucun credential.")}</span>
      ) : (
        <div style={{ display: "grid", gap: 4 }}>
          {creds.map((c) => (
            <div key={c.id} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="tag">{c.kind}</span>
              <strong>{c.name}</strong>
              <span className="kbd" style={{ fontSize: 11 }}>{c.id}</span>
              <span className="muted">{t("champs")}: {c.fields_set.join(", ") || t("aucun")}</span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4, flex: "1 1 180px" }}>
              <span className="muted" style={{ fontSize: 12 }}>{t("Type")}</span>
              <select value={kind} onChange={(e) => { setKind(e.target.value); setValues({}); }} style={{ padding: 8 }}>
                {Object.keys(KIND_FIELDS).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, flex: "2 1 240px" }}>
              <span className="muted" style={{ fontSize: 12 }}>{t("Nom")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={blueprint.hint} style={{ padding: 8 }} />
            </label>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>{blueprint.hint}</div>
          {blueprint.fields.map((f) => (
            <label key={f.key} style={{ display: "grid", gap: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>{f.label}</span>
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                autoComplete="off"
                style={{ padding: 8, fontFamily: f.secret ? "ui-monospace, monospace" : "inherit", fontSize: 12 }}
              />
            </label>
          ))}
          {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
          {ok && <div style={{ color: "var(--good)", fontSize: 13 }}>{ok}</div>}
          <div>
            <button disabled={busy} onClick={save} style={{ padding: "8px 16px", fontWeight: 600 }}>
              {busy ? "…" : t("Enregistrer le credential")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
