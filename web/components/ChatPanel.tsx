"use client";

import { useChat } from "ai/react";

export function ChatPanel() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/chat",
  });

  return (
    <>
      <div className="chat-log">
        {messages.length === 0 && (
          <div style={{ color: "var(--muted)", padding: 8 }}>
            Tapez un message pour démarrer la conversation avec MiniMax-M2.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>

      {error && <div style={{ color: "#ff8080" }}>{error.message}</div>}

      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
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
