"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentInput, LlmProvider } from "@/lib/types";
import {
  AgentDirectivesChatPanel,
  type DirectivesProposal,
  type DirectivesChatContext,
  type FinalizeAgentResult,
} from "./AgentDirectivesChatPanel";

// Management agents only need a text brain — no voice/TTS. Keep the model
// picker minimal and aligned with the platform defaults.
const PROVIDER_MODELS: Record<LlmProvider, { id: string; label: string }[]> = {
  deepseek: [{ id: "deepseek-v4-flash", label: "deepseek-v4-flash — rapide, économique (recommandé)" }],
  openai: [
    { id: "gpt-4o-mini", label: "gpt-4o-mini — rapide et fiable" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5 — excellent suivi d'instructions" },
    { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6 — qualité supérieure" },
  ],
  minimax: [{ id: "MiniMax-M2", label: "MiniMax-M2" }],
};

export function ManagementAgentForm({ orgCategory = null }: { orgCategory?: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("deepseek");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Latest applied directives kept in a ref so a "go" that immediately follows a
  // proposal still finalizes with the freshest values (state may not have
  // flushed within the same model turn).
  const draftRef = useRef({ name: "", description: "", system_prompt: "" });
  draftRef.current = { name, description, system_prompt: systemPrompt };

  const chatContext: DirectivesChatContext = useMemo(
    () => ({ org_category: orgCategory }),
    [orgCategory],
  );

  function applyProposal(p: DirectivesProposal) {
    setSystemPrompt(p.system_prompt);
    draftRef.current.system_prompt = p.system_prompt;
    if (p.description) {
      setDescription(p.description);
      draftRef.current.description = p.description;
    }
    // Only seed the name if the operator hasn't typed one yet.
    if (p.suggested_name && !draftRef.current.name.trim()) {
      setName(p.suggested_name);
      draftRef.current.name = p.suggested_name;
    }
  }

  async function doCreate(): Promise<FinalizeAgentResult> {
    const d = draftRef.current;
    if (!d.name.trim()) return { ok: false, error: "Donne un nom à l'agent (ou laisse l'assistant en proposer un)." };
    if (!d.system_prompt.trim()) return { ok: false, error: "Les directives sont vides — décris d'abord ce que l'agent doit faire." };
    const body: AgentInput = {
      name: d.name.trim(),
      description: d.description.trim() || null,
      purpose: "management",
      llm_provider: provider,
      llm_model: model,
      system_prompt: d.system_prompt,
      // No voice: management agents never speak. Leave TTS/greeting defaults.
      greeting: null,
    };
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j.error ?? `HTTP ${res.status}` };
    }
    const saved = (await res.json()) as { id: string };
    return { ok: true, id: saved.id };
  }

  // Called by the chatbot's finalize_agent tool on an explicit "go".
  async function finalizeFromChat(): Promise<FinalizeAgentResult> {
    setError(null);
    setBusy(true);
    const r = await doCreate();
    if (!r.ok) {
      setError(r.error ?? "Erreur inconnue");
      setBusy(false);
      return r;
    }
    router.push(`/agents/${r.id}`);
    router.refresh();
    return r;
  }

  // Manual create button (fallback to the chat's "go").
  async function onManualCreate() {
    const r = await finalizeFromChat();
    if (!r.ok) return;
  }

  const models = PROVIDER_MODELS[provider];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1000 }}>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        {/* Identity + model */}
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Identité</h3>
          <div>
            <label>Nom *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Relances no-show" />
          </div>
          <div>
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ce que fait l'agent en une phrase…"
            />
          </div>
          <div className="wizard-row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Fournisseur LLM</label>
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as LlmProvider;
                  setProvider(p);
                  setModel(PROVIDER_MODELS[p][0].id);
                }}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="minimax">MiniMax</option>
              </select>
            </div>
            <div>
              <label>Modèle</label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label>Directives de l&apos;agent (son cerveau)</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Rédigées par l'assistant à droite — éditables ici."
              style={{ minHeight: 220, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Tu pourras brancher cet agent à une table / email / WhatsApp ensuite dans <strong>Workflows</strong>.
            </div>
          </div>

          {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onManualCreate} disabled={busy}>
              {busy ? "Création…" : "Créer l'agent de gestion"}
            </button>
            <button type="button" className="ghost" onClick={() => router.push("/agents")} disabled={busy}>
              Annuler
            </button>
          </div>
        </section>

        {/* Directives chatbot */}
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Configure les directives avec l&apos;assistant</h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Explique ce que l&apos;agent doit faire ; l&apos;assistant rédige ses directives (à gauche)
              et crée l&apos;agent quand tu dis « go ».
            </div>
          </div>
          <AgentDirectivesChatPanel
            context={chatContext}
            onProposal={applyProposal}
            onFinalize={finalizeFromChat}
          />
        </section>
      </div>
    </div>
  );
}
