"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";

export interface DirectivesProposal {
  system_prompt: string;
  description?: string;
  suggested_name?: string;
}

export interface DirectivesChatContext {
  org_category: string | null;
}

export interface FinalizeAgentResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Conversational panel to configure a MANAGEMENT agent's directives (its system
 * prompt). The operator describes what the agent should do; the assistant drafts
 * the directives (→ onProposal fills the form) and, on an explicit go, creates
 * the agent (→ onFinalize). Same wiring as the campaign ScheduleChatPanel.
 */
export function AgentDirectivesChatPanel({
  context,
  onProposal,
  onFinalize,
}: {
  context: DirectivesChatContext;
  onProposal: (p: DirectivesProposal) => void;
  onFinalize: () => Promise<FinalizeAgentResult>;
}) {
  const [input, setInput] = useState("");

  const onProposalRef = useRef(onProposal);
  const onFinalizeRef = useRef(onFinalize);
  useEffect(() => {
    onProposalRef.current = onProposal;
    onFinalizeRef.current = onFinalize;
  }, [onProposal, onFinalize]);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agents/directives-chat", body: { context } }),
    [context],
  );

  const { messages, sendMessage, addToolResult, status, error } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName !== "finalize_agent") return;
      try {
        const res = await onFinalizeRef.current();
        addToolResult({
          tool: "finalize_agent",
          toolCallId: toolCall.toolCallId,
          output: res.ok
            ? { ok: true, message: "Agent de gestion créé." }
            : { ok: false, error: res.error ?? "création impossible" },
        });
      } catch (e) {
        addToolResult({
          tool: "finalize_agent",
          toolCallId: toolCall.toolCallId,
          output: { ok: false, error: e instanceof Error ? e.message : "erreur inconnue" },
        });
      }
    },
  });

  const appliedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const msg of messages) {
      for (const part of msg.parts ?? []) {
        const p = part as {
          type: string;
          toolCallId?: string;
          state?: string;
          output?: { ok?: boolean; directives?: DirectivesProposal };
        };
        if (
          p.type === "tool-propose_directives" &&
          p.state === "output-available" &&
          p.toolCallId &&
          !appliedRef.current.has(p.toolCallId) &&
          p.output?.ok &&
          p.output.directives
        ) {
          appliedRef.current.add(p.toolCallId);
          onProposalRef.current(p.output.directives);
        }
      }
    }
  }, [messages]);

  const isLoading = status === "submitted" || status === "streaming";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 420, height: "100%" }}>
      <div className="chat-log" style={{ flex: 1, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--muted)", padding: 8, fontSize: 13, lineHeight: 1.6 }}>
            Décris-moi ce que cet agent de gestion doit faire. Par exemple :
            <br />
            <em>« Relancer par email et WhatsApp les patients en statut no-show, ton chaleureux,
            leur proposer de reprendre RDV, et mettre la fiche à jour quand c&apos;est fait. »</em>
            <br />
            Quand les directives te conviennent, dis <strong>« go »</strong> et je crée l&apos;agent.
          </div>
        )}
        {messages.map((m) => {
          const text = (m.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("");
          if (!text.trim()) return null;
          return (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
            </div>
          );
        })}
        {isLoading && (
          <div className="chat-msg assistant" style={{ opacity: 0.6 }}>
            <span>…</span>
          </div>
        )}
      </div>

      {error && <div style={{ color: "var(--bad)", fontSize: 12 }}>{error.message}</div>}

      <form className="chat-form" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex. : relancer les no-shows par email + WhatsApp…"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          →
        </button>
      </form>
    </div>
  );
}
