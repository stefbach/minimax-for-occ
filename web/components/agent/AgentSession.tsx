"use client";

import { useState } from "react";
import Link from "next/link";
import type { Agent } from "@/lib/types";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { ChatPanel } from "./ChatPanel";
import { AgentN8nBindings } from "./AgentN8nBindings";
import { AgentDocuments } from "./AgentDocuments";
import { OutboundCallModal } from "./OutboundCallModal";
import { HelpButton } from "@/components/help/HelpButton";
import { useT } from "@/lib/i18n";

// Wati 15/06 — Replicate (ElevenLabs Flash/Turbo, MiniMax Speech 02) coexiste
// avec Cartesia depuis la branche preview. Le label de l'en-tête "Voix"
// affichait Cartesia en dur, ce qui contredisait le tag voice:replicate:…
// affiché juste au-dessus quand l'agent est branché sur Replicate.
function ttsLabelFor(voiceId: string | null | undefined): string {
  if (!voiceId) return "Cartesia TTS";
  if (voiceId.startsWith("replicate:elevenlabs-flash")) return "ElevenLabs Flash v2.5 (via Replicate)";
  if (voiceId.startsWith("replicate:elevenlabs-turbo")) return "ElevenLabs Turbo v2.5 (via Replicate)";
  if (voiceId.startsWith("replicate:minimax-turbo")) return "MiniMax Speech 02 Turbo (via Replicate)";
  if (voiceId.startsWith("replicate:minimax-hd")) return "MiniMax Speech 02 HD (via Replicate)";
  if (voiceId.startsWith("replicate:")) return "Replicate TTS";
  return "Cartesia TTS";
}

export function AgentSession({ agent, initialTab }: { agent: Agent; initialTab: string }) {
  const t = useT();
  const [tab, setTab] = useState(initialTab);
  const [dialOpen, setDialOpen] = useState(false);

  const TABS = [
    { id: "session", label: t("Session vocale + chat") },
    { id: "n8n", label: t("Workflows n8n") },
    { id: "rag", label: "RAG" },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{agent.name}</h1>
          <div className="subtitle">
            <span className="tag">{agent.language}</span>{" "}
            <span className="tag">{agent.llm_provider}/{agent.llm_model}</span>{" "}
            {agent.tts_voice_id && <span className="tag">voice: {agent.tts_voice_id}</span>}{" "}
            {agent.rag_enabled && <span className="tag good">RAG on (top-{agent.rag_top_k})</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setDialOpen(true)}
            title={t("Lancer un appel sortant immédiat avec cet agent (sans campagne)")}
          >
            ☎ {t("Passer un appel sortant")}
          </button>
          <Link href={`/agents/${agent.id}/edit`}>
            <button className="ghost">{t("Éditer la config")}</button>
          </Link>
          <HelpButton contextKey="agents.detail" />
        </div>
      </div>

      {dialOpen && (
        <OutboundCallModal
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setDialOpen(false)}
        />
      )}

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
        {TABS.map((tab_item) => (
          <button
            key={tab_item.id}
            onClick={() => setTab(tab_item.id)}
            className={tab === tab_item.id ? "" : "ghost"}
            style={{
              borderRadius: "8px 8px 0 0",
              borderBottom: tab === tab_item.id ? "2px solid var(--accent)" : "2px solid transparent",
              padding: "9px 14px",
              background: tab === tab_item.id ? "var(--accent-soft)" : "transparent",
              color: tab === tab_item.id ? "var(--accent-2)" : "var(--muted)",
              border: "none",
            }}
          >
            {tab_item.label}
          </button>
        ))}
      </div>

      {tab === "session" && (
        <div className="duo">
          <section className="panel">
            <header>
              <h2>{t("Voix")}</h2>
              <div className="meta">LiveKit · {ttsLabelFor(agent.tts_voice_id)} · AssemblyAI STT</div>
            </header>
            <VoicePanel
              agentId={agent.id}
              systemPrompt={agent.system_prompt}
              greeting={agent.greeting}
            />
          </section>
          <section className="panel">
            <header>
              <h2>{t("Chat texte")}</h2>
              <div className="meta">{agent.llm_provider}/{agent.llm_model}{agent.rag_enabled ? " · " + t("RAG actif") : ""}</div>
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
