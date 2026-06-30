"use client";

import { useEffect, useState, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useToast } from "@/lib/use-toast";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";

interface ActionRow {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: "pending" | "confirmed" | "executed" | "failed" | "rejected";
  error: string | null;
  created_at: string;
  executed_at: string | null;
}

const SUGGESTIONS = [
  "Liste mes organisations",
  "Quels workflows n8n sont actifs ?",
  "Liste les agents IA",
  "Crée une org « Demo » avec slug demo",
  "Cherche dans le RAG de l'agent X : « politique de remboursement »",
  "Combien d'appels ont eu lieu aujourd'hui ? (SELECT count(*) from calls where ...)",
];

function fmtArgs(o: unknown): string {
  if (!o) return "";
  try {
    return JSON.stringify(o, null, 2);
  } catch {
    return String(o);
  }
}

function StatusBadge({ s }: { s: ActionRow["status"] }) {
  const colors: Record<ActionRow["status"], string> = {
    pending: "#d4a72c",
    confirmed: "#6bb6ff",
    executed: "#5cd6a0",
    failed: "#ff8080",
    rejected: "#999",
  };
  return (
    <span
      style={{
        background: colors[s],
        color: "#0a0a0a",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {s}
    </span>
  );
}

export function CopilotClient() {
  const t = useT();
  const toast = useToast();
  const [input, setInput] = useState("");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionsErr, setActionsErr] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/copilot/chat" }),
  });
  const isLoading = status === "submitted" || status === "streaming";

  const refreshActions = useCallback(async () => {
    try {
      const r = await fetch("/api/copilot/actions?limit=30");
      if (!r.ok) {
        setActionsErr(`audit fetch failed: ${r.status}`);
        return;
      }
      setActions((await r.json()) as ActionRow[]);
      setActionsErr(null);
    } catch (e) {
      setActionsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshActions();
    const timer = setInterval(refreshActions, 5000);
    return () => clearInterval(timer);
  }, [refreshActions]);

  async function confirmAction(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/copilot/actions/${id}/confirm`, { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(`Échec : ${j.error ?? r.statusText}`);
      } else {
        toast.success(t("Action confirmée."));
      }
      await refreshActions();
    } finally {
      setBusy(null);
    }
  }

  async function rejectAction(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/copilot/actions/${id}/confirm`, { method: "DELETE" });
      await refreshActions();
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  function useSuggestion(s: string) {
    sendMessage({ text: s });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 280px", gap: 16, height: "calc(100vh - 200px)" }}>
      {/* Sidebar gauche — suggestions */}
      <aside
        style={{
          background: "var(--card)",
          borderRadius: 8,
          padding: 12,
          overflowY: "auto",
          fontSize: 13,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          {t("Suggestions")}
        </div>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => useSuggestion(s)}
            disabled={isLoading}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--fg)",
              padding: "8px 10px",
              borderRadius: 6,
              marginBottom: 6,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </aside>

      {/* Chat */}
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--card)",
          borderRadius: 8,
          padding: 16,
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 8 }}>
          {messages.length === 0 && (
            <div style={{ color: "var(--muted)", padding: 8 }}>
              Bienvenue. Demande-moi par exemple <em>« liste les orgs »</em> ou
              <em> « quels workflows n8n sont actifs »</em>.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--muted-2)", marginBottom: 4 }}>
                {m.role === "user" ? t("Vous") : t("Copilote")}
              </div>
              {m.parts?.map((p, i) => {
                if (p.type === "text") {
                  return (
                    <div key={i} style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {(p as { type: "text"; text: string }).text}
                    </div>
                  );
                }
                // Tool call UI parts: in @ai-sdk v6 these appear as `tool-*`.
                const tp = p as { type: string; toolName?: string; input?: unknown; output?: unknown; state?: string };
                if (tp.type?.startsWith("tool-") || tp.type === "tool-invocation" || tp.type === "dynamic-tool") {
                  const name = tp.toolName ?? tp.type.replace(/^tool-/, "");
                  const out = tp.output as { pending?: boolean; action_id?: string; summary?: string } | undefined;
                  return (
                    <div
                      key={i}
                      style={{
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.02)",
                        borderRadius: 6,
                        padding: 10,
                        marginTop: 6,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong>tool · {name}</strong>
                        {tp.state && <span style={{ color: "var(--muted-2)" }}>{tp.state}</span>}
                      </div>
                      {tp.input != null && (
                        <details>
                          <summary style={{ cursor: "pointer", color: "var(--muted-2)" }}>arguments</summary>
                          <pre style={{ background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 4, overflowX: "auto" }}>
                            {fmtArgs(tp.input)}
                          </pre>
                        </details>
                      )}
                      {out?.pending && out.action_id ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ marginBottom: 6 }}>{out.summary ?? t("Action en attente de confirmation.")}</div>
                          <button
                            type="button"
                            onClick={() => confirmAction(out.action_id!)}
                            disabled={busy === out.action_id}
                            style={{
                              background: "#5cd6a0",
                              color: "#0a0a0a",
                              border: "none",
                              padding: "6px 12px",
                              borderRadius: 4,
                              cursor: "pointer",
                              marginRight: 6,
                              fontWeight: 600,
                            }}
                          >
                            {busy === out.action_id ? "…" : t("Confirmer")}
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectAction(out.action_id!)}
                            disabled={busy === out.action_id}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border)",
                              color: "var(--fg)",
                              padding: "6px 12px",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                          >
                            {t("Rejeter")}
                          </button>
                        </div>
                      ) : tp.output != null ? (
                        <details>
                          <summary style={{ cursor: "pointer", color: "var(--muted-2)" }}>{t("résultat")}</summary>
                          <pre style={{ background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 4, overflowX: "auto", maxHeight: 220 }}>
                            {fmtArgs(tp.output)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ))}
          {error && (
            <div style={{ color: "#ff8080", fontSize: 13, marginTop: 8 }}>
              {error.message}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("Vous") === "You" ? "E.g. « create Demo org with demo slug »" : "Ex. « crée une org Demo avec slug demo »"}
            disabled={isLoading}
            style={{
              flex: 1,
              background: "var(--input-bg, rgba(0,0,0,0.3))",
              border: "1px solid var(--border)",
              color: "var(--fg)",
              padding: "10px 12px",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              background: "var(--accent, #6bb6ff)",
              color: "#0a0a0a",
              border: "none",
              padding: "10px 16px",
              borderRadius: 6,
              cursor: isLoading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {isLoading ? "…" : t("Envoyer")}
          </button>
        </form>
      </main>

      {/* Sidebar droite — audit */}
      <aside
        style={{
          background: "var(--card)",
          borderRadius: 8,
          padding: 12,
          overflowY: "auto",
          fontSize: 12,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Audit log
        </div>
        {actionsErr && <div style={{ color: "#ff8080", marginBottom: 8 }}>{actionsErr}</div>}
        {auditLoading && actions.length === 0 ? (
          <SkeletonRows count={4} />
        ) : (
          actions.length === 0 && <div style={{ color: "var(--muted)" }}>{t("Aucune action.")}</div>
        )}
        {actions.map((a) => (
          <div
            key={a.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 8,
              marginBottom: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <strong style={{ fontSize: 11 }}>{a.tool_name}</strong>
              <StatusBadge s={a.status} />
            </div>
            <div style={{ color: "var(--muted-2)", fontSize: 10 }}>
              {new Date(a.created_at).toLocaleString()}
            </div>
            {a.status === "pending" && (
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => confirmAction(a.id)}
                  disabled={busy === a.id}
                  style={{
                    background: "#5cd6a0",
                    color: "#0a0a0a",
                    border: "none",
                    padding: "4px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {t("Confirmer")}
                </button>
                <button
                  type="button"
                  onClick={() => rejectAction(a.id)}
                  disabled={busy === a.id}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                    padding: "4px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {t("Rejeter")}
                </button>
              </div>
            )}
            {a.error && <div style={{ color: "#ff8080", fontSize: 11, marginTop: 4 }}>{a.error}</div>}
          </div>
        ))}
      </aside>
    </div>
  );
}
