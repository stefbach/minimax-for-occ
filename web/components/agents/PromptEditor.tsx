"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export interface PromptVersion {
  id: string;
  agent_id: string;
  version: number;
  system_prompt: string;
  greeting: string | null;
  note: string | null;
  created_at: string;
}

interface Props {
  agentId?: string;
  value: string;
  onChange: (v: string) => void;
  greeting?: string;
  /** When the user picks a historical version to restore in-place. */
  onRestoreGreeting?: (greeting: string) => void;
  rows?: number;
  placeholder?: string;
}

/**
 * Long-form Markdown editor for an agent's system prompt with a
 * "Versions" dropdown to inspect history and restore a previous version.
 *
 * Versions only load + save when `agentId` is provided (i.e. on the edit
 * page, not the /agents/new wizard). On create-mode, the editor degrades
 * gracefully to a plain textarea.
 */
export function PromptEditor({
  agentId,
  value,
  onChange,
  greeting,
  onRestoreGreeting,
  rows = 12,
  placeholder = "You are a voice assistant for…",
}: Props) {
  const t = useT();
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!agentId) return;
    const r = await fetch(`/api/agents/${agentId}/prompt-versions`);
    if (r.ok) setVersions(await r.json());
  }

  useEffect(() => {
    if (showVersions) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVersions, agentId]);

  async function saveVersion() {
    if (!agentId) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/agents/${agentId}/prompt-versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_prompt: value,
        greeting: greeting ?? null,
        note: note || null,
      }),
    });
    setBusy(false);
    if (r.ok) {
      setMsg(t("Version enregistrée."));
      setNote("");
      refresh();
    } else {
      const j = await r.json().catch(() => ({}));
      setMsg(j.error ?? t("Erreur"));
    }
  }

  async function restore(v: PromptVersion) {
    if (!agentId) return;
    if (!confirm(t("Restaurer la version") + ` v${v.version} ? ` + t("La version actuelle sera enregistrée d'abord."))) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/agents/${agentId}/prompt-versions/${v.version}/restore`, {
      method: "POST",
    });
    setBusy(false);
    if (r.ok) {
      onChange(v.system_prompt);
      if (onRestoreGreeting && v.greeting != null) onRestoreGreeting(v.greeting);
      setMsg(t("Version") + ` v${v.version} ` + t("restaurée."));
      refresh();
    } else {
      const j = await r.json().catch(() => ({}));
      setMsg(j.error ?? t("Erreur"));
    }
  }

  function preview(v: PromptVersion) {
    onChange(v.system_prompt);
    if (onRestoreGreeting && v.greeting != null) onRestoreGreeting(v.greeting);
    setMsg(t("Brouillon chargé depuis") + ` v${v.version} (` + t("non enregistré tant que vous ne cliquez pas sur Enregistrer comme version") + `).`);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ margin: 0 }}>{t("Prompt système (Markdown)")}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="ghost"
            style={{ padding: "4px 8px", fontSize: 12 }}
            onClick={() => setFullscreen((s) => !s)}
            title={t("Plein écran")}
          >
            {fullscreen ? t("↙ Réduire") : t("↗ Plein écran")}
          </button>
          {agentId && (
            <button
              type="button"
              className="ghost"
              style={{ padding: "4px 8px", fontSize: 12 }}
              onClick={() => setShowVersions((s) => !s)}
              title={t("Historique des versions")}
            >
              {showVersions ? t("▾ Versions") : t("▸ Versions")}
            </button>
          )}
        </div>
      </div>

      <textarea
        rows={fullscreen ? 32 : rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.5,
          ...(fullscreen
            ? {
                position: "fixed",
                inset: 24,
                zIndex: 1000,
                width: "calc(100vw - 48px)",
                height: "calc(100vh - 48px)",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 16,
              }
            : {}),
        }}
      />

      {agentId && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("Note (optionnel) — ex. 'ajout des instructions de facturation'")}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button type="button" onClick={saveVersion} disabled={busy} className="ghost">
            {busy ? "…" : t("Enregistrer comme version")}
          </button>
        </div>
      )}

      {msg && <div style={{ color: "var(--muted)", fontSize: 12 }}>{msg}</div>}

      {showVersions && agentId && (
        <div className="card" style={{ padding: 8 }}>
          {versions.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 6 }}>{t("Aucune version enregistrée.")}</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {versions.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 1fr auto auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "6px 8px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span className="tag">v{v.version}</span>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {new Date(v.created_at).toLocaleString()}
                      {v.note ? ` · ${v.note}` : ""}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted-2)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 600,
                      }}
                      title={v.system_prompt}
                    >
                      {v.system_prompt.slice(0, 160)}
                    </div>
                  </div>
                  <button type="button" className="ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => preview(v)}>
                    {t("Aperçu")}
                  </button>
                  <button type="button" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => restore(v)} disabled={busy}>
                    {t("Restaurer")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
