"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { NormalizedSchedule } from "@/lib/campaigns/schedule-proposal";

export interface ScheduleChatContext {
  mode: "static" | "dynamic";
  default_timezone: string | null;
  table_label: string | null;
  status_column: string | null;
  detected_relance_phases: number | null;
  concurrency_limit: number | null;
}

export interface FinalizeResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Conversational "Quand ?" panel. The operator describes their call cadence in
 * plain language; the agent calls `propose_schedule` (→ onProposal fills the
 * live recap) and, on an explicit go, `finalize_campaign` (→ onFinalize creates
 * the draft). Mirrors the existing ChatPanel/CopilotPanel wiring.
 */
export function ScheduleChatPanel({
  context,
  onProposal,
  onFinalize,
}: {
  context: ScheduleChatContext;
  onProposal: (schedule: NormalizedSchedule) => void;
  onFinalize: () => Promise<FinalizeResult>;
}) {
  const [input, setInput] = useState("");

  // Keep the wizard callbacks in refs so useChat's captured handlers always
  // call the latest version (the wizard re-creates them each render as its
  // state changes). Avoids stale-closure finalization.
  const onProposalRef = useRef(onProposal);
  const onFinalizeRef = useRef(onFinalize);
  useEffect(() => {
    onProposalRef.current = onProposal;
    onFinalizeRef.current = onFinalize;
  }, [onProposal, onFinalize]);

  // Re-create the transport when the campaign context changes (e.g. operator
  // goes back and switches table/mode) so every request — including the
  // automatic tool-result continuations — carries fresh context.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/campaigns/schedule-chat", body: { context } }),
    [context],
  );

  const { messages, sendMessage, addToolResult, status, error } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName !== "finalize_campaign") return;
      try {
        const res = await onFinalizeRef.current();
        addToolResult({
          tool: "finalize_campaign",
          toolCallId: toolCall.toolCallId,
          output: res.ok
            ? { ok: true, message: "Campagne créée en brouillon." }
            : { ok: false, error: res.error ?? "création impossible" },
        });
      } catch (e) {
        addToolResult({
          tool: "finalize_campaign",
          toolCallId: toolCall.toolCallId,
          output: { ok: false, error: e instanceof Error ? e.message : "erreur inconnue" },
        });
      }
    },
  });

  // Apply each `propose_schedule` result to the wizard recap exactly once.
  const appliedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const msg of messages) {
      for (const part of msg.parts ?? []) {
        const p = part as {
          type: string;
          toolCallId?: string;
          state?: string;
          output?: { ok?: boolean; schedule?: NormalizedSchedule };
        };
        if (
          p.type === "tool-propose_schedule" &&
          p.state === "output-available" &&
          p.toolCallId &&
          !appliedRef.current.has(p.toolCallId) &&
          p.output?.ok &&
          p.output.schedule
        ) {
          appliedRef.current.add(p.toolCallId);
          onProposalRef.current(p.output.schedule);
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 420,
        height: "100%",
      }}
    >
      <div className="chat-log" style={{ flex: 1, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--muted)", padding: 8, fontSize: 13, lineHeight: 1.6 }}>
            Décris-moi quand tu veux passer les appels. Par exemple :
            <br />
            <em>« Du lundi au vendredi, le matin de 9h à 12h, fuseau Maurice.</em>
            {context.mode === "dynamic" && (
              <em> Relances à J+1 et J+3, 50 nouveaux contacts par jour max.</em>
            )}
            <em> »</em>
            <br />
            Quand tout est bon, dis <strong>« go »</strong> et je crée la campagne en brouillon.
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
          placeholder="Ex. : en semaine, 9h–12h, fuseau Maurice…"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          →
        </button>
      </form>
    </div>
  );
}
