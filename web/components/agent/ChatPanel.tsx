"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export function ChatPanel({ agentId }: { agentId: string }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { agent_id: agentId },
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
    <>
      <div className="chat-log">
        {messages.length === 0 && (
          <div style={{ color: "var(--muted)", padding: 8 }}>
            Tapez un message pour démarrer la conversation textuelle avec cet agent.
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

      {error && <div style={{ color: "#ff8080", fontSize: 13 }}>{error.message}</div>}

      <form className="chat-form" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Votre message…"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Envoyer
        </button>
      </form>
    </>
  );
}
