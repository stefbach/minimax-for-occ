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
    { id: "deepseek-v4-flash", label: "deepseek-v4-flash — Réponses immédiates (1-2s) et 3× moins cher, idéal pour les appels en temps réel (recommandé)" },
    { id: "deepseek-v4-pro", label: "deepseek-v4-pro — Plus puissant mais ~3× plus cher, pour analyses ou décisions complexes" },
    { id: "deepseek-reasoner", label: "deepseek-reasoner — Réfléchit avant de répondre (5-30s), pour calculs ou décisions multi-étapes" },
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

type TTSFamily = "speech-02" | "speech-01";

const TTS_MODELS: { id: string; label: string; family: TTSFamily }[] = [
  { id: "speech-02-hd",          label: "speech-02-hd — Qualité HD multilingue, latence standard", family: "speech-02" },
  { id: "speech-02-turbo",       label: "speech-02-turbo — Plus rapide, qualité standard",         family: "speech-02" },
  { id: "speech-2.5-hd-preview", label: "speech-2.5-hd (preview) — Qualité maximale (en bêta)",     family: "speech-02" },
  { id: "speech-01-turbo",       label: "speech-01-turbo — Économique, latence ultra-faible",       family: "speech-01" },
  { id: "speech-01",             label: "speech-01 (legacy) — Compatibilité voix historiques",      family: "speech-01" },
];

// Each MiniMax model family has its own voice catalog. Picking a voice
// from the wrong catalog makes the API silently fall back to a default.
type BuiltinVoice = { id: string; label: string; group: string };
const BUILTIN_VOICES: Record<TTSFamily, BuiltinVoice[]> = {
  "speech-02": [
    { id: "Calm_Woman",         label: "Femme calme (Calm_Woman)",                       group: "Femmes adultes" },
    { id: "Wise_Woman",         label: "Femme posée (Wise_Woman)",                       group: "Femmes adultes" },
    { id: "Lively_Girl",        label: "Jeune femme dynamique (Lively_Girl)",            group: "Jeunes femmes / adolescentes" },
    { id: "Inspirational_girl", label: "Jeune femme inspirante (Inspirational_girl)",    group: "Jeunes femmes / adolescentes" },
    { id: "Lovely_Girl",        label: "Jeune femme douce (Lovely_Girl)",                group: "Jeunes femmes / adolescentes" },
    { id: "Sweet_Girl_2",       label: "Jeune femme chaleureuse (Sweet_Girl_2)",         group: "Jeunes femmes / adolescentes" },
    { id: "Exuberant_Girl",     label: "Jeune femme enthousiaste (Exuberant_Girl)",      group: "Jeunes femmes / adolescentes" },
    { id: "Patient_Man",        label: "Homme patient (Patient_Man)",                    group: "Hommes adultes" },
    { id: "Casual_Guy",         label: "Homme décontracté (Casual_Guy)",                 group: "Hommes adultes" },
    { id: "Determined_Man",     label: "Homme déterminé (Determined_Man)",               group: "Hommes adultes" },
    { id: "Deep_Voice_Man",     label: "Homme voix grave (Deep_Voice_Man)",              group: "Hommes adultes" },
    { id: "Elegant_Man",        label: "Homme élégant (Elegant_Man)",                    group: "Hommes adultes" },
    { id: "Decent_Boy",         label: "Jeune homme professionnel (Decent_Boy)",         group: "Jeune homme" },
    { id: "Friendly_Person",    label: "Personne amicale (Friendly_Person)",             group: "Neutre" },
  ],
  "speech-01": [
    { id: "female-chengshu",     label: "Femme adulte (female-chengshu)",                group: "Femmes adultes" },
    { id: "female-yujie",        label: "Femme mature (female-yujie)",                   group: "Femmes adultes" },
    { id: "female-tianmei",      label: "Femme douce (female-tianmei)",                  group: "Femmes adultes" },
    { id: "female-shaonv",       label: "Jeune femme (female-shaonv)",                   group: "Jeunes femmes" },
    { id: "male-qn-jingying",    label: "Homme professionnel (male-qn-jingying)",        group: "Hommes adultes" },
    { id: "male-qn-qingse",      label: "Homme posé (male-qn-qingse)",                   group: "Hommes adultes" },
    { id: "male-qn-badao",       label: "Homme autoritaire (male-qn-badao)",             group: "Hommes adultes" },
    { id: "male-qn-daxuesheng",  label: "Jeune homme étudiant (male-qn-daxuesheng)",     group: "Jeune homme" },
    { id: "presenter_female",    label: "Présentatrice (presenter_female)",              group: "Présentateurs" },
    { id: "presenter_male",      label: "Présentateur (presenter_male)",                 group: "Présentateurs" },
    { id: "audiobook_female_1",  label: "Narratrice 1 (audiobook_female_1)",             group: "Narrateurs audiobook" },
    { id: "audiobook_female_2",  label: "Narratrice 2 (audiobook_female_2)",             group: "Narrateurs audiobook" },
    { id: "audiobook_male_1",    label: "Narrateur 1 (audiobook_male_1)",                group: "Narrateurs audiobook" },
    { id: "audiobook_male_2",    label: "Narrateur 2 (audiobook_male_2)",                group: "Narrateurs audiobook" },
  ],
};

function ttsFamilyFor(modelId: string | null | undefined): TTSFamily {
  return TTS_MODELS.find((m) => m.id === modelId)?.family ?? "speech-02";
}

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
    const m = initial?.llm_model ?? "deepseek-v4-flash";
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

  // Tabbed layout grouped by CONCEPT (not by difficulty): each tab is a
  // self-contained aspect of the agent — who it is, how it sounds, how it
  // thinks. Technical knobs live in a collapsible "Réglages avancés" WITHIN
  // the relevant tab so nothing is split across tabs.
  const [tab, setTab] = useState<"identite" | "voix" | "cerveau">("identite");
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [showBrainAdvanced, setShowBrainAdvanced] = useState(false);

  // Inline voice cloning (folds Voice Studio into the agent's Voix section).
  const [showClone, setShowClone] = useState(false);
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneVoiceId, setCloneVoiceId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);

  async function doClone() {
    if (!cloneFile || cloneVoiceId.trim().length < 8 || !cloneName.trim()) return;
    if (!/^[A-Za-z][A-Za-z0-9_]{7,63}$/.test(cloneVoiceId.trim())) {
      setError("voice_id : 8–64 caractères, commence par une lettre, A-Z / 0-9 / _ uniquement.");
      return;
    }
    setCloning(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", cloneFile);
      fd.set("voice_id", cloneVoiceId.trim());
      fd.set("display_name", cloneName.trim());
      fd.set("language", language);
      fd.set("model", ttsModel);
      const r = await fetch("/api/voices", { method: "POST", body: fd, credentials: "same-origin" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error || `Échec du clonage (${r.status})`);
        return;
      }
      // Refresh the catalog and auto-select the freshly cloned voice.
      const list = await fetch("/api/voices").then((x) => (x.ok ? x.json() : []));
      setVoices(Array.isArray(list) ? list : []);
      setVoice(cloneVoiceId.trim());
      setShowClone(false);
      setCloneFile(null);
      setCloneVoiceId("");
      setCloneName("");
    } finally {
      setCloning(false);
    }
  }

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

  // ── TTS family → compatible voice catalog ──────────────────────────────
  const ttsFamily = ttsFamilyFor(ttsModel);
  const voiceFamilyOf = (v: Voice): TTSFamily => {
    const m = (v.metadata as Record<string, unknown> | null)?.["model"];
    const modelId = typeof m === "string" ? m : "speech-02-hd";
    return ttsFamilyFor(modelId);
  };
  const customCloned = voices.filter((v) => v.source === "cloned" && voiceFamilyOf(v) === ttsFamily);
  const customPresets = voices.filter((v) => v.source === "preset" && voiceFamilyOf(v) === ttsFamily);

  const builtinForFamily = BUILTIN_VOICES[ttsFamily];
  const builtinGroups: [string, BuiltinVoice[]][] = (() => {
    const map = new Map<string, BuiltinVoice[]>();
    for (const v of builtinForFamily) {
      const list = map.get(v.group) ?? [];
      list.push(v);
      map.set(v.group, list);
    }
    return Array.from(map.entries());
  })();

  const knownVoiceIds = new Set<string>([
    ...builtinForFamily.map((v) => v.id),
    ...customCloned.map((v) => v.voice_id),
    ...customPresets.map((v) => v.voice_id),
  ]);

  // If the user switches model family and the current voice is no longer
  // available in the new family's catalog, fall back to "default MiniMax".
  useEffect(() => {
    if (voice && !knownVoiceIds.has(voice)) {
      setVoice("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsModel]);

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

      {/* ─── Tab bar (grouped by concept) ─── */}
      <div style={{ display: "flex", gap: 4 }}>
        {([
          { id: "identite", label: "🪪 Identité" },
          { id: "voix", label: "🎙️ Voix" },
          { id: "cerveau", label: "🧠 Cerveau & comportement" },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: tab === t.id ? 600 : 400,
              background: tab === t.id ? "var(--surface-2, rgba(255,255,255,0.06))" : "transparent",
              color: tab === t.id ? "var(--fg)" : "var(--muted)",
              border: "none",
              borderBottom: tab === t.id ? "2px solid var(--accent, #ff6b35)" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ IDENTITÉ : qui est l'agent ═══ */}
      {tab === "identite" && (
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
      )}

      {/* ═══ VOIX : comment l'agent sonne (tout le voice ici) ═══ */}
      {tab === "voix" && (
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Voix</h3>
          <div>
            <label>Voix de l&apos;agent</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="">— défaut MiniMax —</option>
              {customCloned.length > 0 && (
                <optgroup label="Mes voix clonées">
                  {customCloned.map((v) => (
                    <option key={v.id} value={v.voice_id}>{v.display_name}</option>
                  ))}
                </optgroup>
              )}
              {customPresets.length > 0 && (
                <optgroup label="Voix presets">
                  {customPresets.map((v) => (
                    <option key={v.id} value={v.voice_id}>{v.display_name}</option>
                  ))}
                </optgroup>
              )}
              {builtinGroups.map(([groupName, options]) => (
                <optgroup key={groupName} label={`Voix MiniMax — ${groupName}`}>
                  {options.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
              ))}
              {voice && !knownVoiceIds.has(voice) && (
                <option value={voice}>{voice} (manuel)</option>
              )}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="ghost" disabled={previewing} onClick={onPreviewVoice}>
              {previewing ? "Synthèse en cours…" : "▶ Écouter cette voix"}
            </button>
            <button type="button" className="ghost" onClick={() => setShowClone((v) => !v)}>
              {showClone ? "Annuler le clonage" : "+ Cloner une nouvelle voix"}
            </button>
          </div>

          {/* Inline voice cloning (folds Voice Studio in here). */}
          {showClone && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Échantillon <strong>mp3 / wav / m4a</strong>, mono, 10 s à 5 min, ≤ 20 Mo.
                La voix sera clonée pour le modèle TTS <span className="kbd">{ttsModel}</span>.
              </div>
              <div className="form-row">
                <div>
                  <label>Fichier audio</label>
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f && !/\.(mp3|wav|m4a)$/i.test(f.name)) {
                        setError(`Format non supporté : "${f.name}". Utilise mp3, wav ou m4a.`);
                        e.target.value = "";
                        setCloneFile(null);
                        return;
                      }
                      setCloneFile(f);
                    }}
                  />
                  {cloneFile && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      {cloneFile.name} ({(cloneFile.size / 1024 / 1024).toFixed(2)} Mo)
                    </div>
                  )}
                </div>
                <div>
                  <label>Nom affiché</label>
                  <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="Voix Dr Coste" />
                </div>
              </div>
              <div>
                <label>
                  voice_id technique{" "}
                  <span style={{ color: "var(--muted)", fontWeight: "normal", fontSize: 12 }}>
                    (8–64 car., commence par une lettre, A-Z / 0-9 / _)
                  </span>
                </label>
                <input
                  value={cloneVoiceId}
                  onChange={(e) => setCloneVoiceId(e.target.value)}
                  placeholder="voix_dr_coste"
                  pattern="[A-Za-z][A-Za-z0-9_]{7,63}"
                />
              </div>
              <div>
                <button
                  type="button"
                  onClick={doClone}
                  disabled={cloning || !cloneFile || cloneVoiceId.trim().length < 8 || !cloneName.trim()}
                >
                  {cloning ? "Clonage en cours…" : "Cloner et utiliser cette voix"}
                </button>
              </div>
            </div>
          )}

          {/* Réglages avancés voix — repliés par défaut */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowVoiceAdvanced((v) => !v)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "4px 0",
                fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6,
              }}
              aria-expanded={showVoiceAdvanced}
            >
              <span style={{ transition: "transform 0.15s", transform: showVoiceAdvanced ? "rotate(90deg)" : "none" }}>›</span>
              ⚙ Réglages avancés (modèle TTS, émotion, vitesse)
            </button>
            {showVoiceAdvanced && (
              <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                <div className="form-row">
                  <div>
                    <label>Modèle TTS</label>
                    <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)}>
                      {TTS_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Le catalogue de voix ci-dessus dépend de ce modèle ({ttsFamily} family).
                    </div>
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ CERVEAU & COMPORTEMENT : comment l'agent pense/parle ═══ */}
      {tab === "cerveau" && (
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Cerveau & comportement</h3>
          <div>
            <label>Salutation à l&apos;entrée en session</label>
            <input value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </div>
          <PromptEditor
            agentId={initial?.id}
            value={systemPrompt}
            onChange={setSystemPrompt}
            greeting={greeting}
            onRestoreGreeting={setGreeting}
            placeholder="Tu es un assistant vocal pour la pharmacie Tibok. Tu parles en français et en anglais. Tu peux..."
          />

          {/* Réglages avancés cerveau — repliés par défaut */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowBrainAdvanced((v) => !v)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "4px 0",
                fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6,
              }}
              aria-expanded={showBrainAdvanced}
            >
              <span style={{ transition: "transform 0.15s", transform: showBrainAdvanced ? "rotate(90deg)" : "none" }}>›</span>
              ⚙ Réglages avancés (modèle LLM, base de connaissances)
            </button>
            {showBrainAdvanced && (
              <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                <div className="form-row">
                  <div>
                    <label>Fournisseur LLM</label>
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
                <div className="form-row">
                  <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 18 }}
                      checked={rag}
                      onChange={(e) => setRag(e.target.checked)}
                    />
                    Base de connaissances (RAG)
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
            )}
          </div>
        </div>
      )}

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
