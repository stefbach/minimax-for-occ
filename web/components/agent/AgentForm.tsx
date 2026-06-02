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
    { id: "deepseek-v4-flash", label: "deepseek-v4-flash — Ultra rapide (1-2s), cache prefix, 3× moins cher (recommandé appels vocaux)" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "gpt-4o-mini — Rapide et économique (recommandé appels vocaux)" },
    { id: "gpt-4o", label: "gpt-4o — Polyvalent haute qualité" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini — Dernière génération, économique" },
    { id: "gpt-4.1", label: "gpt-4.1 — Dernière génération" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5 — Ultra rapide, multilingue (recommandé appels vocaux)" },
    { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6 — Équilibre qualité/vitesse" },
  ],
  minimax: [
    { id: "MiniMax-M2", label: "MiniMax-M2 — Standard" },
  ],
};

const PROVIDER_MODEL_IDS: Record<LlmProvider, string[]> = Object.fromEntries(
  Object.entries(PROVIDER_MODELS).map(([k, v]) => [k, v.map((m) => m.id)]),
) as Record<LlmProvider, string[]>;

const TTS_MODELS: { id: string; label: string }[] = [
  { id: "sonic-3",     label: "sonic-3 — Dernière génération, latence ultra-faible (recommandé)" },
  { id: "sonic-2",     label: "sonic-2 — Stable, grande qualité" },
  { id: "sonic-turbo", label: "sonic-turbo — Le plus rapide, qualité bonne" },
];

// Cartesia emotions (subset of TTSVoiceEmotion — most useful for voice calls)
const CARTESIA_EMOTIONS = [
  "Neutral", "Calm", "Serene", "Content", "Happy", "Curious",
  "Confident", "Determined", "Proud", "Sympathetic", "Apologetic",
  "Enthusiastic", "Warm", "Contemplative", "Grateful",
] as const;

interface CartesiaVoiceCatalog {
  id: string;
  name: string;
  language: string | null;
  gender: string | null;
  country: string | null;
  is_public: boolean;
}

const LANG_NAMES: Record<string, string> = {
  fr: "Français", en: "Anglais", es: "Espagnol", de: "Allemand",
  it: "Italien", pt: "Portugais", zh: "Mandarin", ja: "Japonais",
  ko: "Coréen", nl: "Néerlandais", pl: "Polonais", ar: "Arabe",
};
const GENDER_LABELS: Record<string, string> = {
  feminine: "Féminine", masculine: "Masculine", neutral: "Neutre",
};
const COUNTRY_LABELS: Record<string, string> = {
  AF: "Afghanistan", AL: "Albanie", AR: "Argentine", AU: "Australie",
  AT: "Autriche", AZ: "Azerbaïdjan", BD: "Bangladesh", BE: "Belgique",
  BG: "Bulgarie", BO: "Bolivie", BR: "Brésil", CA: "Canada",
  CH: "Suisse", CL: "Chili", CN: "Chine", CO: "Colombie",
  CZ: "Tchéquie", DE: "Allemagne", DK: "Danemark", DO: "Rép. Dominicaine",
  EC: "Équateur", EG: "Égypte", ES: "Espagne", ET: "Éthiopie",
  FI: "Finlande", FR: "France", GB: "Grande-Bretagne", GE: "Géorgie",
  GH: "Ghana", GR: "Grèce", GT: "Guatemala", HK: "Hong Kong",
  HR: "Croatie", HU: "Hongrie", ID: "Indonésie", IE: "Irlande",
  IL: "Israël", IN: "Inde", IQ: "Irak", IT: "Italie",
  JP: "Japon", KE: "Kenya", KR: "Corée du Sud", KZ: "Kazakhstan",
  LT: "Lituanie", LV: "Lettonie", MA: "Maroc", MX: "Mexique",
  MY: "Malaisie", NG: "Nigeria", NL: "Pays-Bas", NO: "Norvège",
  NZ: "Nouvelle-Zélande", PA: "Panama", PE: "Pérou", PH: "Philippines",
  PK: "Pakistan", PL: "Pologne", PT: "Portugal", PY: "Paraguay",
  RO: "Roumanie", RS: "Serbie", RU: "Russie", SA: "Arabie Saoudite",
  SE: "Suède", SG: "Singapour", SI: "Slovénie", SK: "Slovaquie",
  TH: "Thaïlande", TR: "Turquie", TW: "Taïwan", TZ: "Tanzanie",
  UA: "Ukraine", UG: "Ouganda", US: "États-Unis", UY: "Uruguay",
  UZ: "Ouzbékistan", VE: "Venezuela", VN: "Vietnam", ZA: "Afrique du Sud",
  ZW: "Zimbabwe",
};

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

// Maps agent language to ISO 639-1 for Cartesia preview.
// "multi"/unknown → undefined (Cartesia auto-detects from text).
const CARTESIA_LANGUAGE: Record<string, string> = {
  fr: "fr",
  en: "en",
  es: "es",
  de: "de",
  it: "it",
};

export function AgentForm({ initial }: { initial?: Agent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoiceCatalog[]>([]);
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
  const [volume, setVolume] = useState(initial?.tts_volume ?? 1.0);
  const [ttsModel, setTtsModel] = useState(initial?.tts_model ?? "sonic-3");
  const [voiceStyle, setVoiceStyle] = useState(initial?.voice_style ?? "");
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

  // Voice catalog filters
  const [filterLang, setFilterLang] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  // Inline voice cloning (Cartesia /voices/clone).
  const [showClone, setShowClone] = useState(false);
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);

  async function doClone() {
    if (!cloneFile || !cloneName.trim()) return;
    setCloning(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", cloneFile);
      fd.set("display_name", cloneName.trim());
      fd.set("language", language);
      const r = await fetch("/api/voices", { method: "POST", body: fd, credentials: "same-origin" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error || `Échec du clonage (${r.status})`);
        return;
      }
      // Refresh the catalog and auto-select the freshly cloned voice.
      const list = await fetch("/api/voices").then((x) => (x.ok ? x.json() : []));
      setVoices(Array.isArray(list) ? list : []);
      setVoice(body.voice_id ?? "");
      setShowClone(false);
      setCloneFile(null);
      setCloneName("");
    } finally {
      setCloning(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Load cloned voices from Supabase.
    fetch("/api/voices")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setVoices(Array.isArray(data) ? data : []); })
      .catch(() => {});
    // Load Cartesia catalog voices (returns [] when API key not configured).
    fetch("/api/voices/cartesia")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setCartesiaVoices(Array.isArray(data) ? data : []); })
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
          const lower = m.toLowerCase();
          if (lower.startsWith("claude")) setProvider("anthropic");
          else if (lower.startsWith("gpt") || lower.startsWith("o4") || lower.startsWith("o3")) setProvider("openai");
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
      tts_volume: volume,
      tts_pitch: 0,
      tts_model: ttsModel || null,
      voice_style: voiceStyle || null,
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
          voice_id: voice || "f786b574-daa5-4673-aa0c-cbe3e8534c02",
          text: greeting || "Bonjour, je suis votre assistant.",
          model: ttsModel || "sonic-3",
          speed: speed !== 1.0 ? speed : undefined,
          emotion: emotion || undefined,
          language: CARTESIA_LANGUAGE[language] ?? undefined,
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

  // ── Voice catalog (from API + cloned in Supabase) ──────────────────────
  const customCloned = voices.filter((v) => v.source === "cloned");
  const customPresets = voices.filter((v) => v.source === "preset");

  // Derive filter options from catalog data.
  const catalogLangs = [...new Set(cartesiaVoices.map((v) => v.language).filter(Boolean) as string[])].sort();
  const catalogGenders = [...new Set(cartesiaVoices.map((v) => v.gender).filter(Boolean) as string[])].sort();
  const catalogCountries = [...new Set(cartesiaVoices.map((v) => v.country).filter(Boolean) as string[])].sort();

  // Apply active filters.
  const filteredCatalog = cartesiaVoices.filter((v) => {
    if (filterLang && v.language !== filterLang) return false;
    if (filterGender && v.gender !== filterGender) return false;
    if (filterCountry && v.country !== filterCountry) return false;
    return true;
  });

  // Group filtered catalog by language.
  const catalogGroups: [string, CartesiaVoiceCatalog[]][] = (() => {
    const map = new Map<string, CartesiaVoiceCatalog[]>();
    for (const v of filteredCatalog) {
      const lang = v.language ?? "other";
      const list = map.get(lang) ?? [];
      list.push(v);
      map.set(lang, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "fr") return -1;
      if (b === "fr") return 1;
      if (a === "en") return -1;
      if (b === "en") return 1;
      return a.localeCompare(b);
    });
  })();

  const knownVoiceIds = new Set<string>([
    ...cartesiaVoices.map((v) => v.id),
    ...customCloned.map((v) => v.voice_id),
    ...customPresets.map((v) => v.voice_id),
  ]);

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
              <option value="">— voix par défaut —</option>
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
              {catalogGroups.map(([lang, options]) => (
                <optgroup key={lang} label={LANG_NAMES[lang] ?? lang.toUpperCase()}>
                  {options.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.gender ? ` (${GENDER_LABELS[v.gender] ?? v.gender})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
              {cartesiaVoices.length === 0 && (
                <option value="" disabled>Catalogue vocal non disponible (clé API manquante)</option>
              )}
              {voice && !knownVoiceIds.has(voice) && (
                <option value={voice}>{voice} (ID manuel)</option>
              )}
            </select>

            {/* Horizontal filter bar — below the dropdown, like Cartesia's UI */}
            {cartesiaVoices.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                <select
                  value={filterGender}
                  onChange={(e) => setFilterGender(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface-2, rgba(255,255,255,0.06))", color: "inherit", cursor: "pointer" }}
                >
                  <option value="">Tous les genres</option>
                  {catalogGenders.map((g) => (
                    <option key={g} value={g}>{GENDER_LABELS[g] ?? g}</option>
                  ))}
                </select>
                <select
                  value={filterLang}
                  onChange={(e) => setFilterLang(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface-2, rgba(255,255,255,0.06))", color: "inherit", cursor: "pointer" }}
                >
                  <option value="">Toutes les langues</option>
                  {catalogLangs.map((l) => (
                    <option key={l} value={l}>{LANG_NAMES[l] ?? l.toUpperCase()}</option>
                  ))}
                </select>
                <select
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface-2, rgba(255,255,255,0.06))", color: "inherit", cursor: "pointer" }}
                >
                  <option value="">Tous les accents</option>
                  {catalogCountries.map((c) => (
                    <option key={c} value={c}>{COUNTRY_LABELS[c] ?? c}</option>
                  ))}
                </select>
                {(filterLang || filterGender || filterCountry) && (
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20 }}
                    onClick={() => { setFilterLang(""); setFilterGender(""); setFilterCountry(""); }}
                  >
                    ✕ Effacer
                  </button>
                )}
                <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>
                  {filteredCatalog.length} voix
                </span>
              </div>
            )}
          </div>

          {/* Manual UUID entry */}
          <div>
            <label>ID de voix manuel (UUID)</label>
            <input
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              placeholder="ex: a0e99841-438c-4a64-b679-ae501e7d6091"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              Collez ici l&apos;identifiant UUID d&apos;une voix spécifique.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="ghost" disabled={previewing} onClick={onPreviewVoice}>
              {previewing ? "Synthèse en cours…" : "▶ Écouter cette voix"}
            </button>
            <button type="button" className="ghost" onClick={() => setShowClone((v) => !v)}>
              {showClone ? "Annuler le clonage" : "+ Cloner une nouvelle voix"}
            </button>
          </div>

          {/* Inline voice cloning via Cartesia /voices/clone. */}
          {showClone && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Clonage vocal instantané. Échantillon <strong>mp3 / wav / m4a</strong>,
                voix unique, 5 s à 5 min, ≤ 20 Mo. La voix sera disponible immédiatement dans le catalogue.
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
                <button
                  type="button"
                  onClick={doClone}
                  disabled={cloning || !cloneFile || !cloneName.trim()}
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
                  </div>
                  <div>
                    <label>Émotion vocale</label>
                    <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
                      <option value="">— aucune —</option>
                      {CARTESIA_EMOTIONS.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Coloration émotionnelle appliquée sur chaque réponse vocale.
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label>Vitesse ({speed.toFixed(2)}×)</label>
                    <input
                      type="range" min="0.5" max="2" step="0.05"
                      value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label>Volume ({volume.toFixed(1)})</label>
                    <input
                      type="range" min="0.1" max="2" step="0.1"
                      value={volume} onChange={(e) => setVolume(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <label>Style &amp; ton (consigne LLM)</label>
                  <textarea
                    rows={2}
                    value={voiceStyle}
                    onChange={(e) => setVoiceStyle(e.target.value)}
                    placeholder="Ex: chaleureux et rassurant, débit posé, sourire dans la voix, jamais pressé."
                  />
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    Injecté dans les instructions de l&apos;agent — guide la façon de formuler (complète l&apos;émotion TTS).
                  </div>
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
                      <option value="deepseek">DeepSeek (recommandé)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic Claude</option>
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
