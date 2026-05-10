"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, AgentInput, LlmProvider } from "@/lib/types";

const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
  minimax: ["MiniMax-M2", "MiniMax-M2-Stable"],
};

const LANGUAGES = [
  { id: "multi", label: "Multilingue (FR/EN)" },
  { id: "fr", label: "Français" },
  { id: "en", label: "Anglais" },
  { id: "es", label: "Espagnol" },
  { id: "de", label: "Allemand" },
  { id: "it", label: "Italien" },
];

export function AgentForm({ initial }: { initial?: Agent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [language, setLanguage] = useState(initial?.language ?? "multi");
  const [provider, setProvider] = useState<LlmProvider>(initial?.llm_provider ?? "openai");
  const [model, setModel] = useState(initial?.llm_model ?? "gpt-4o");
  const [voice, setVoice] = useState(initial?.tts_voice_id ?? "");
  const [emotion, setEmotion] = useState(initial?.tts_emotion ?? "");
  const [speed, setSpeed] = useState(initial?.tts_speed ?? 1.0);
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [greeting, setGreeting] = useState(initial?.greeting ?? "Bonjour, je vous écoute.");
  const [rag, setRag] = useState(initial?.rag_enabled ?? false);
  const [ragK, setRagK] = useState(initial?.rag_top_k ?? 4);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: AgentInput = {
      name,
      description: description || null,
      language,
      llm_provider: provider,
      llm_model: model,
      tts_voice_id: voice || null,
      tts_emotion: emotion || null,
      tts_speed: speed,
      system_prompt: systemPrompt,
      greeting,
      rag_enabled: rag,
      rag_top_k: ragK,
    };
    const url = initial ? `/api/agents/${initial.id}` : "/api/agents";
    const method = initial ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `${method} failed (${res.status})`);
      return;
    }
    const saved = (await res.json()) as Agent;
    router.push(`/agents/${saved.id}`);
    router.refresh();
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Supprimer l'agent « ${initial.name} » ? Cette action est irréversible.`)) return;
    setBusy(true);
    const res = await fetch(`/api/agents/${initial.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Suppression échouée");
      return;
    }
    router.push("/agents");
    router.refresh();
  }

  const models = PROVIDER_MODELS[provider];

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ display: "grid", gap: 14 }}>
        <h3 style={{ margin: 0 }}>Identité</h3>
        <div className="form-row">
          <div>
            <label>Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Réceptionniste Tibok" />
          </div>
          <div>
            <label>Langue principale</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="À quoi sert cet agent ?" />
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 14 }}>
        <h3 style={{ margin: 0 }}>Cerveau (LLM)</h3>
        <div className="form-row">
          <div>
            <label>Fournisseur</label>
            <select value={provider} onChange={(e) => {
              const p = e.target.value as LlmProvider;
              setProvider(p);
              setModel(PROVIDER_MODELS[p][0]);
            }}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="minimax">MiniMax</option>
            </select>
          </div>
          <div>
            <label>Modèle</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value={model}>{model} (custom)</option>
            </select>
          </div>
        </div>
        <div>
          <label>Prompt système</label>
          <textarea
            rows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Tu es un assistant vocal pour la pharmacie Tibok. Tu parles en français et en anglais. Tu peux..."
          />
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 14 }}>
        <h3 style={{ margin: 0 }}>Voix (MiniMax TTS)</h3>
        <div className="form-row">
          <div>
            <label>Voice ID (clone ou preset)</label>
            <input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="my_cloned_voice" />
          </div>
          <div>
            <label>Émotion</label>
            <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
              <option value="">— défaut —</option>
              <option value="neutral">neutral</option>
              <option value="happy">happy</option>
              <option value="sad">sad</option>
              <option value="angry">angry</option>
              <option value="fearful">fearful</option>
              <option value="disgusted">disgusted</option>
              <option value="surprised">surprised</option>
            </select>
          </div>
        </div>
        <div>
          <label>Vitesse ({speed.toFixed(2)}×)</label>
          <input
            type="range" min="0.5" max="2" step="0.05"
            value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </div>
        <div>
          <label>Salutation à l&apos;entrée en session</label>
          <input value={greeting} onChange={(e) => setGreeting(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 14 }}>
        <h3 style={{ margin: 0 }}>RAG (Supabase pgvector)</h3>
        <div className="form-row">
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 0 }}>
            <input
              type="checkbox"
              style={{ width: 18 }}
              checked={rag}
              onChange={(e) => setRag(e.target.checked)}
            />
            Activer la recherche documentaire
          </label>
          <div>
            <label>Top-K passages à injecter</label>
            <input
              type="number" min="1" max="12"
              value={ragK} onChange={(e) => setRagK(Number(e.target.value))}
              disabled={!rag}
            />
          </div>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
        <button type="submit" disabled={busy || !name}>
          {busy ? "…" : initial ? "Enregistrer" : "Créer l'agent"}
        </button>
        {initial && (
          <button type="button" className="danger" onClick={onDelete} disabled={busy}>
            Supprimer l&apos;agent
          </button>
        )}
      </div>
    </form>
  );
}
