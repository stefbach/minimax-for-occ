"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export function CopilotPanel({ orgId, fullPage = false }: { orgId?: string; fullPage?: boolean }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/dashboard/copilot",
      body: { org_id: orgId },
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <aside
      style={{
        width: fullPage ? "100%" : 320,
        flexShrink: 0,
        position: fullPage ? "static" : "sticky",
        top: 16,
        alignSelf: "flex-start",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        height: "calc(100vh - 56px)",
        minHeight: 480,
        maxWidth: fullPage ? 900 : undefined,
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: 15 }}>Co-pilot manager</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          Pose une question sur l&apos;activité du jour.
        </div>
      </header>

      <div className="chat-log" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--muted)", padding: 8, fontSize: 13 }}>
            Essaie : « Quels appels ont été abandonnés aujourd&apos;hui ? » ou « Quelle
            campagne avance le plus vite ? »
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.parts
              ?.filter((p) => p.type === "text")
              .map((p, i) => (
                <span key={i}>{(p as { type: "text"; text: string }).text}</span>
              ))}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ color: "var(--bad)", fontSize: 12 }}>{error.message}</div>
      )}

      <form className="chat-form" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Votre question…"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          →
        </button>
      </form>
    </aside>
  );
}
