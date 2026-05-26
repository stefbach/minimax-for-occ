"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Agent, AgentInput, LlmProvider, Voice } from "@/lib/types";
import { PromptEditor } from "@/components/agents/PromptEditor";
import { parsePersona, serializePersona } from "@/lib/personas/parser";

type ModelOption = { id: string; label: string };

const PROVIDER_MODELS: Record<LlmProvider, ModelOption[]> = {
  deepseek: [
    { id: "deepseek-chat", label: "deepseek-chat — Réponses immédiates (1-2s), pour conversations fluides en temps réel" },
    { id: "deepseek-reasoner", label: "deepseek-reasoner — Réfléchit avant de répondre (5-30s), pour analyses, calculs ou décisions multi-étapes" },
  ],
  openai: [
    { id: "gpt-4o", label: "gpt-4o — Polyvalent haute qualité" },
    { id: "gpt-4o-mini", label: "gpt-4o-mini — Rapide et économique" },
    { id: "gpt-4.1", label: "gpt-4.1 — Dernière génération" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini — Dernière génération, économique" },
    { id: "o4-mini", label: "o4-mini — Raisonnement avancé" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5 — Équilibre qualité/vitesse" },
    { id: "claude-opus-4-5", label: "claude-opus-4-5 — Qualité maximale" },
    { id: "claude-haiku-4-5", label: "claude-haiku-4-5 — Ultra rapide" },
  ],
  minimax: [
    { id: "MiniMax-M2", label: "MiniMax-M2 — Standard" },
    { id: "MiniMax-M2-Stable", label: "MiniMax-M2-Stable — Production stable" },
  ],
};

const PROVIDER_MODEL_IDS: Record<LlmProvider, string[]> = Object.fromEntries(
  Object.entries(PROVIDER_MODELS).map(([k, v]) => [k, v.map((m) => m.id)]),
) as Record<LlmProvider, string[]>;

const TTS_MODELS = [
  { id: "speech-02-hd", label: "speech-02-hd (HD multilingue, recommandé)" },
  { id: "speech-2.5-hd-preview", label: "speech-2.5-hd (preview, qualité maximale)" },
  { id: "speech-02-turbo", label: "speech-02-turbo (rapide, multilingue)" },
  { id: "speech-01-turbo", label: "speech-01-turbo (rapide, économique)" },
  { id: "speech-01", label: "speech-01 (legacy)" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "agent";
}

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
  const [voices, setVoices] = useState<Voice[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [language, setLanguage] = useState(initial?.language ?? "multi");
  const [provider, setProvider] = useState<LlmProvider>(initial?.llm_provider ?? "deepseek");
  const [model, setModel] = useState(() => {
    const p: LlmProvider = initial?.llm_provider ?? "deepseek";
    const m = initial?.llm_model ?? "deepseek-chat";
    const ids = PROVIDER_MODEL_IDS[p] ?? [];
    return ids.includes(m) ? m : (ids[0] ?? m);
  });
  const [voice, setVoice] = useState(initial?.tts_voice_id ?? "");
  const [emotion, setEmotion] = useState(initial?.tts_emotion ?? "");
  const [speed, setSpeed] = useState(initial?.tts_speed ?? 1.0);
  const [ttsModel, setTtsModel] = useState(initial?.tts_model ?? "speech-02-hd");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [greeting, setGreeting] = useState(initial?.greeting ?? "Bonjour, je vous écoute.");
  const [rag, setRag] = useState(initial?.rag_enabled ?? false);
  const [ragK, setRagK] = useState(initial?.rag_top_k ?? 4);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voices")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setVoices(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onImportMd(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      try {
        const { frontmatter, body } = parsePersona(text);
        if (typeof frontmatter.title === "string") setName(frontmatter.title);
        if (typeof frontmatter.language === "string") setLanguage(frontmatter.language);
        if (typeof frontmatter.llm_model === "string") {
          const m = frontmatter.llm_model;
          // try to infer provider from model name
          const lower = m.toLowerCase();
          if (lower.startsWith("claude")) setProvider("anthropic");
          else if (lower.startsWith("minimax")) setProvider("minimax");
          else if (lower.startsWith("deepseek")) setProvider("deepseek");
          else setProvider("deepseek");
          setModel(m);
        }
        if (body) setSystemPrompt(body);
        // voice_suggestion is informational only — we don't auto-set voice_id
        // because the persona hint format (gender_style_age) differs from the
        // MiniMax voice_id format.
        setError(null);
      } catch {
        setError("Impossible de parser le fichier .md");
      }
    };
    reader.readAsText(file);
  }

  function onExportMd() {
    const slug = slugify(name || "agent");
    const md = serializePersona({
      frontmatter: {
        slug,
        title: name,
        language,
        llm_model: model,
        voice_suggestion: voice || undefined,
        tags: [language, provider].filter(Boolean) as string[],
      },
      body: systemPrompt || "",
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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
      tts_model: ttsModel || null,
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

  async function onPreviewVoice() {
    setPreviewing(true);
    setError(null);
    try {
      const r = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voice_id: voice || "Calm_Woman",
          text: greeting || "Bonjour, je suis votre assistant.",
          model: ttsModel || undefined,
          speed,
          emotion: emotion || undefined,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `${r.status}`);
      }
      const buf = await r.arrayBuffer();
      const blob = new Blob([buf], { type: "audio/mpeg" });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      await audioRef.current.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }

  const llmModels = PROVIDER_MODELS[provider];
  const cloned = voices.filter((v) => v.source === "cloned");
  const presets = voices.filter((v) => v.source === "preset");

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Importez un persona <span className="kbd">.md</span> pour remplir ce formulaire, ou exportez la configuration actuelle.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportMd(f);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            ⬆ Importer .md
          </button>
          <button type="button" className="ghost" onClick={onExportMd}>
            ⬇ Exporter .md
          </button>
          <Link href="/agents/library">
            <button type="button" className="ghost">
              ⊕ Bibliothèque
            </button>
          </Link>
        </div>
      </div>

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
              setModel(PROVIDER_MODELS[p][0].id);
            }}>
              <option value="deepseek">DeepSeek</option>
              <option value="minimax">MiniMax</option>
            </select>
          </div>
          <div>
            <label>Modèle</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {llmModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {!llmModels.some((m) => m.id === model) && <option value={model}>{model} (personnalisé)</option>}
            </select>
          </div>
        </div>
        <PromptEditor
          agentId={initial?.id}
          value={systemPrompt}
          onChange={setSystemPrompt}
          greeting={greeting}
          onRestoreGreeting={setGreeting}
          placeholder="Tu es un assistant vocal pour la pharmacie Tibok. Tu parles en français et en anglais. Tu peux..."
        />
      </div>

      <div className="card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Voix (MiniMax TTS)</h3>
          <Link href="/voices" style={{ fontSize: 12, color: "var(--muted)" }}>
            Gérer dans Voice Studio →
          </Link>
        </div>
        <div className="form-row">
          <div>
            <label>Voix</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="">— défaut MiniMax —</option>
              {cloned.length > 0 && (
                <optgroup label="Mes voix clonées">
                  {cloned.map((v) => (
                    <option key={v.id} value={v.voice_id}>{v.display_name}</option>
                  ))}
                </optgroup>
              )}
              {presets.length > 0 && (
                <optgroup label="Voix presets (Voice Studio)">
                  {presets.map((v) => (
                    <option key={v.id} value={v.voice_id}>{v.display_name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Voix MiniMax — Femmes adultes">
                <option value="Calm_Woman">Femme calme (Calm_Woman)</option>
                <option value="Wise_Woman">Femme posée (Wise_Woman)</option>
              </optgroup>
              <optgroup label="Voix MiniMax — Jeunes femmes / adolescentes">
                <option value="Lively_Girl">Jeune femme dynamique (Lively_Girl)</option>
                <option value="Inspirational_girl">Jeune femme inspirante (Inspirational_girl)</option>
                <option value="Lovely_Girl">Jeune femme douce (Lovely_Girl)</option>
                <option value="Sweet_Girl_2">Jeune femme chaleureuse (Sweet_Girl_2)</option>
                <option value="Exuberant_Girl">Jeune femme enthousiaste (Exuberant_Girl)</option>
              </optgroup>
              <optgroup label="Voix MiniMax — Hommes adultes">
                <option value="Patient_Man">Homme patient (Patient_Man)</option>
                <option value="Casual_Guy">Homme décontracté (Casual_Guy)</option>
                <option value="Determined_Man">Homme déterminé (Determined_Man)</option>
                <option value="Deep_Voice_Man">Homme voix grave (Deep_Voice_Man)</option>
                <option value="Elegant_Man">Homme élégant (Elegant_Man)</option>
              </optgroup>
              <optgroup label="Voix MiniMax — Jeune homme">
                <option value="Decent_Boy">Jeune homme professionnel (Decent_Boy)</option>
              </optgroup>
              <optgroup label="Voix MiniMax — Neutre">
                <option value="Friendly_Person">Personne amicale (Friendly_Person)</option>
              </optgroup>
              {voice && !voices.some((v) => v.voice_id === voice) && !["Calm_Woman","Wise_Woman","Friendly_Person","Lively_Girl","Inspirational_girl","Lovely_Girl","Sweet_Girl_2","Exuberant_Girl","Patient_Man","Casual_Guy","Decent_Boy","Determined_Man","Deep_Voice_Man","Elegant_Man"].includes(voice) && (
                <option value={voice}>{voice} (manuel)</option>
              )}
            </select>
          </div>
          <div>
            <label>Modèle TTS</label>
            <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)}>
              {TTS_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
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
          <div>
            <label>Vitesse ({speed.toFixed(2)}×)</label>
            <input
              type="range" min="0.5" max="2" step="0.05"
              value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <label>Salutation à l&apos;entrée en session</label>
          <input value={greeting} onChange={(e) => setGreeting(e.target.value)} />
        </div>
        <div>
          <button
            type="button"
            className="ghost"
            disabled={previewing}
            onClick={onPreviewVoice}
          >
            {previewing ? "Synthèse en cours…" : "▶ Écouter cette voix"}
          </button>
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
