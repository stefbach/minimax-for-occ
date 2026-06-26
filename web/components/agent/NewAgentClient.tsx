"use client";

import { useState } from "react";
import { AgentForm } from "./AgentForm";
import { ManagementAgentForm } from "./ManagementAgentForm";

type AgentType = "telephony" | "management";

/**
 * First step of agent creation: pick what KIND of agent. Telephony agents speak
 * on calls (used in Campaigns); management agents run automations (used in
 * Workflows). The choice routes to the right form — telephony keeps the full
 * voice form, management gets the slim identity + directives-chat form.
 */
export function NewAgentClient({ orgCategory = null }: { orgCategory?: string | null }) {
  const [type, setType] = useState<AgentType | null>(null);

  if (type === "telephony") {
    return (
      <>
        <BackLink onClick={() => setType(null)} />
        <AgentForm />
      </>
    );
  }
  if (type === "management") {
    return (
      <>
        <BackLink onClick={() => setType(null)} />
        <ManagementAgentForm orgCategory={orgCategory} />
      </>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", maxWidth: 760 }}>
      <Card
        emoji="🎙"
        title="Telephony agent"
        desc="Speaks on calls. Voice, model, prompt and greeting. Used in Campaigns to make calls."
        onClick={() => setType("telephony")}
      />
      <Card
        emoji="⚙️"
        title="Management agent"
        desc="Runs automations: email/WhatsApp follow-ups, record updates. Configured by chat, used in Workflows."
        onClick={() => setType("management")}
      />
    </div>
  );
}

function Card({ emoji, title, desc, onClick }: { emoji: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="card"
      onClick={onClick}
      style={{
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 18,
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{title}</div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="ghost"
      onClick={onClick}
      style={{ padding: "4px 10px", fontSize: 13, alignSelf: "flex-start", marginBottom: 4 }}
    >
      ← Change agent type
    </button>
  );
}
