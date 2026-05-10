"use client";

import { useState } from "react";
import Link from "next/link";
import type { Agent } from "@/lib/types";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { ChatPanel } from "./ChatPanel";
import { AgentN8nBindings } from "./AgentN8nBindings";
import { AgentDocuments } from "./AgentDocuments";

const TABS = [
  { id: "session", label: "Session vocale + chat" },
  { id: "n8n", label: "Workflows n8n" },
  { id: "rag", label: "RAG / Documents" },
];

export function AgentSession({ agent, initialTab }: { agent: Agent; initialTab: string }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{agent.name}</h1>
          <div className="subtitle">
            <span className="tag">{agent.language}</span>{" "}
            <span className="tag">{agent.llm_provider}/{agent.llm_model}</span>{" "}
            {agent.tts_voice_id && <span className="tag">voix: {agent.tts_voice_id}</span>}{" "}
            {agent.rag_enabled && <span className="tag good">RAG on (top-{agent.rag_top_k})</span>}
          </div>
        </div>
        <Link href={`/agents/${agent.id}/edit`}>
          <button className="ghost">Éditer la config</button>
        </Link>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? "" : "ghost"}
            style={{
              borderRadius: "8px 8px 0 0",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              padding: "9px 14px",
              background: tab === t.id ? "var(--accent-soft)" : "transparent",
              color: tab === t.id ? "var(--accent-2)" : "var(--muted)",
              border: "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "session" && (
        <div className="duo">
          <section className="panel">
            <header>
              <h2>Voix</h2>
              <div className="meta">LiveKit · MiniMax TTS · Deepgram STT</div>
            </header>
            <VoicePanel agentId={agent.id} />
          </section>
          <section className="panel">
            <header>
              <h2>Chat texte</h2>
              <div className="meta">{agent.llm_provider}/{agent.llm_model}{agent.rag_enabled ? " · RAG actif" : ""}</div>
            </header>
            <ChatPanel agentId={agent.id} />
          </section>
        </div>
      )}

      {tab === "n8n" && <AgentN8nBindings agentId={agent.id} />}
      {tab === "rag" && <AgentDocuments agentId={agent.id} />}
    </>
  );
}
