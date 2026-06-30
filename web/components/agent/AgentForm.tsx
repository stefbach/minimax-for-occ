"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Agent, AgentInput, LlmProvider, Voice } from "@/lib/types";
import { PromptEditor } from "@/components/agents/PromptEditor";
import { parsePersona, serializePersona } from "@/lib/personas/parser";
import { AgentNumbersSection } from "@/components/agent/AgentNumbersSection";

type ModelOption = { id: string; label: string };

// Coût estimé / minute d'appel (≈ 6k input cached + 1k input frais + 500 output
// tokens par minute de conversation). Prix juin 2026, API directe (pas via
// Retell ou autre intermédiaire qui rajoute sa marge). Coûts uniquement LLM —
// la facture totale ajoute TTS + STT + Twilio + LK Cloud (≈ $0.05–0.06/min hors
// LLM).
const PROVIDER_MODELS: Record<LlmProvider, ModelOption[]> = {
  deepseek: [
    { id: "deepseek-v4-flash", label: "deepseek-v4-flash ($0.001/min) — Ultra fast, 3× cheaper (recommended for voice calls)" },
  ],
  openai: [
    { id: "gpt-4.1-nano", label: "gpt-4.1-nano ($0.001/min) — Ultra fast, minimal latency (recommended for voice calls)" },
    { id: "gpt-4o-mini",  label: "gpt-4o-mini ($0.002/min) — Fast and economical" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini ($0.004/min) — Latest generation, economical" },
    { id: "gpt-4.1",      label: "gpt-4.1 ($0.016/min) — Latest generation, high quality" },
    { id: "gpt-4o",       label: "gpt-4o ($0.020/min) — Versatile, high quality" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5 ($0.005/min) — Ultra fast, multilingual (recommended)" },
    { id: "claude-sonnet-4-6",         label: "claude-sonnet-4-6 ($0.020/min) — Quality/speed balance" },
  ],
  minimax: [
    { id: "MiniMax-M2", label: "MiniMax-M2 — Standard" },
  ],
};

const PROVIDER_MODEL_IDS: Record<LlmProvider, string[]> = Object.fromEntries(
  Object.entries(PROVIDER_MODELS).map(([k, v]) => [k, v.map((m) => m.id)]),
) as Record<LlmProvider, string[]>;

const TTS_MODELS: { id: string; label: string }[] = [
  { id: "sonic-3.5",   label: "sonic-3.5 — Latest generation, 42 languages (recommended)" },
  { id: "sonic-3",     label: "sonic-3 — Previous generation, stable" },
];

interface CartesiaVoiceCatalog {
  id: string;
  name: string;
  language: string | null;
  gender: string | null;
  country: string | null;
  is_public: boolean;
}

// Catalogue Replicate (Wati preview 15/06) — meme structure normalisee
// que Cartesia pour reutiliser les memes filtres/affichage. La famille
// distingue ElevenLabs Flash/Turbo et MiniMax Turbo/HD pour grouper le
// dropdown par fournisseur.
interface ReplicateVoiceCatalog {
  id: string;
  name: string;
  description: string | null;
  language: string | null;
  gender: string | null;
  is_public: boolean;
  family: string; // "elevenlabs-flash" | "elevenlabs-turbo" | "minimax-turbo" | "minimax-hd"
}

const REPLICATE_FAMILY_LABELS: Record<string, string> = {
  // ElevenLabs direct (Wati 16/06) — WebSocket streaming, TTFB ~75ms.
  "elevenlabs-flash-direct": "ElevenLabs Flash v2.5",
  "elevenlabs-turbo-direct": "ElevenLabs Turbo v2.5",
  // MiniMax direct (Wati 16/06) — SSE streaming natif, TTFB ~400ms.
  "minimax-turbo-direct": "MiniMax Speech 02 Turbo",
  "minimax-hd-direct": "MiniMax Speech 02 HD",
  // MiniMax via Replicate — legacy depuis Wati 16/06.
  "minimax-turbo": "MiniMax Speech 02 Turbo (Replicate)",
  "minimax-hd": "MiniMax Speech 02 HD (Replicate)",
};

const LANG_NAMES: Record<string, string> = {
  multi: "Multilingual",
  fr: "French", en: "English", es: "Spanish", de: "German",
  it: "Italian", pt: "Portuguese", zh: "Mandarin", ja: "Japanese",
  ko: "Korean", nl: "Dutch", pl: "Polish", ar: "Arabic",
  ru: "Russian", tr: "Turkish", hi: "Hindi", id: "Indonesian",
  vi: "Vietnamese", th: "Thai", sv: "Swedish", no: "Norwegian",
  da: "Danish", fi: "Finnish", cs: "Czech", el: "Greek",
  he: "Hebrew", hu: "Hungarian", ro: "Romanian", uk: "Ukrainian",
  hr: "Croatian", bg: "Bulgarian", sk: "Slovak", sl: "Slovenian",
  bn: "Bengali", gu: "Gujarati", ta: "Tamil", te: "Telugu",
  ml: "Malayalam", kn: "Kannada", mr: "Marathi", pa: "Punjabi",
  ur: "Urdu", fa: "Persian", sw: "Swahili", ms: "Malay",
  fil: "Filipino", tl: "Tagalog", af: "Afrikaans", sq: "Albanian",
  az: "Azerbaijani", ka: "Georgian", hy: "Armenian", kk: "Kazakh",
  uz: "Uzbek", lt: "Lithuanian", lv: "Latvian", et: "Estonian",
  sr: "Serbian", mk: "Macedonian", bs: "Bosnian", is: "Icelandic",
  ga: "Irish", cy: "Welsh", mt: "Maltese", eu: "Basque",
  ca: "Catalan", gl: "Galician",
};
const GENDER_LABELS: Record<string, string> = {
  feminine: "Feminine", masculine: "Masculine", neutral: "Neutral",
  female: "Feminine", male: "Masculine",
  f: "Feminine", m: "Masculine", n: "Neutral",
};
// Wati 16/06 — normalise tous les genres bruts vers le canonique 3-valeurs
// avant de les afficher / filtrer, pour eliminer les doublons.
function normalizeGender(g: string | null | undefined): string | null {
  if (!g) return null;
  const x = g.toLowerCase();
  if (x === "female" || x === "feminine" || x === "f") return "feminine";
  if (x === "male" || x === "masculine" || x === "m") return "masculine";
  if (x === "neutral" || x === "neutre" || x === "n") return "neutral";
  return g;
}
const COUNTRY_LABELS: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", AR: "Argentina", AU: "Australia",
  AT: "Austria", AZ: "Azerbaijan", BD: "Bangladesh", BE: "Belgium",
  BG: "Bulgaria", BO: "Bolivia", BR: "Brazil", CA: "Canada",
  CH: "Switzerland", CL: "Chile", CN: "China", CO: "Colombia",
  CZ: "Czech Republic", DE: "Germany", DK: "Denmark", DO: "Dominican Rep.",
  EC: "Ecuador", EG: "Egypt", ES: "Spain", ET: "Ethiopia",
  FI: "Finland", FR: "France", GB: "United Kingdom", GE: "Georgia",
  GH: "Ghana", GR: "Greece", GT: "Guatemala", HK: "Hong Kong",
  HR: "Croatia", HU: "Hungary", ID: "Indonesia", IE: "Ireland",
  IL: "Israel", IN: "India", IQ: "Iraq", IT: "Italy",
  JP: "Japan", KE: "Kenya", KR: "South Korea", KZ: "Kazakhstan",
  LT: "Lithuania", LV: "Latvia", MA: "Morocco", MX: "Mexico",
  MY: "Malaysia", NG: "Nigeria", NL: "Netherlands", NO: "Norway",
  NZ: "New Zealand", PA: "Panama", PE: "Peru", PH: "Philippines",
  PK: "Pakistan", PL: "Poland", PT: "Portugal", PY: "Paraguay",
  RO: "Romania", RS: "Serbia", RU: "Russia", SA: "Saudi Arabia",
  SE: "Sweden", SG: "Singapore", SI: "Slovenia", SK: "Slovakia",
  TH: "Thailand", TR: "Turkey", TW: "Taiwan", TZ: "Tanzania",
  UA: "Ukraine", UG: "Uganda", US: "United States", UY: "Uruguay",
  UZ: "Uzbekistan", VE: "Venezuela", VN: "Vietnam", ZA: "South Africa",
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
  { id: "multi", label: "Multilingual (FR/EN)" },
  { id: "fr", label: "French" },
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
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
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoiceCatalog[]>([]);
  const [replicateVoices, setReplicateVoices] = useState<ReplicateVoiceCatalog[]>([]);
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
  const [speed, setSpeed] = useState(initial?.tts_speed ?? 1.0);
  const [volume, setVolume] = useState(initial?.tts_volume ?? 1.0);
  const [pitch, setPitch] = useState(initial?.tts_pitch ?? 0);
  const [ttsEmotion, setTtsEmotion] = useState<string>(initial?.tts_emotion ?? "");
  // Advanced TTS knobs (Wati 16/06). null = "use provider default".
  const [ttsLanguage, setTtsLanguage] = useState<string>(initial?.tts_language ?? "");
  const [stability, setStability] = useState<number | null>(
    initial?.tts_stability ?? null,
  );
  const [similarityBoost, setSimilarityBoost] = useState<number | null>(
    initial?.tts_similarity_boost ?? null,
  );
  const [styleVal, setStyleVal] = useState<number | null>(
    initial?.tts_style ?? null,
  );
  const [speakerBoost, setSpeakerBoost] = useState<boolean>(
    initial?.tts_speaker_boost ?? true,
  );
  const [englishNorm, setEnglishNorm] = useState<boolean>(
    initial?.tts_english_normalization ?? false,
  );
  const [ttsModel, setTtsModel] = useState(() => {
    const valid = TTS_MODELS.map((m) => m.id);
    const stored = initial?.tts_model ?? "";
    return valid.includes(stored) ? stored : "sonic-3.5";
  });
  const [voiceStyle, setVoiceStyle] = useState(initial?.voice_style ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [greeting, setGreeting] = useState(initial?.greeting ?? "Hello, how can I help you?");
  const [rag, setRag] = useState(initial?.rag_enabled ?? false);
  const [ragK, setRagK] = useState(initial?.rag_top_k ?? 4);
  const [previewing, setPreviewing] = useState(false);

  // Tabbed layout grouped by CONCEPT (not by difficulty): each tab is a
  // self-contained aspect of the agent — who it is, how it sounds, how it
  // thinks. Technical knobs live in a collapsible "Réglages avancés" WITHIN
  // the relevant tab so nothing is split across tabs.
  const [tab, setTab] = useState<"identity" | "voice" | "brain">("identity");
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [showBrainAdvanced, setShowBrainAdvanced] = useState(false);

  // Voice catalog filters
  const [filterLang, setFilterLang] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  // Filtre fournisseur (Wati 15/06) : "" tous, "cartesia", "elevenlabs-flash",
  // "elevenlabs-turbo", "minimax-turbo", "minimax-hd". Évite de scroller dans
  // 881 voix quand on cherche par exemple uniquement ElevenLabs Flash.
  const [filterProvider, setFilterProvider] = useState("");

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
        setError(body.error || `Cloning failed (${r.status})`);
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
    // Load Replicate catalog voices. ElevenLabs y est legacy depuis Wati 16/06
    // (on a ElevenLabs direct). MiniMax via Replicate est ÉCARTÉ ici (Wati
    // 18/06) — on ne veut QUE MiniMax DIRECT (/api/voices/minimax), pas le hop
    // Replicate. On filtre donc les familles "minimax*" du catalogue Replicate.
    // Renvoie [] si REPLICATE_API_TOKEN n'est pas configure.
    fetch("/api/voices/replicate")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setReplicateVoices(arr.filter((v) => !String(v?.family || "").startsWith("minimax")));
      })
      .catch(() => {});
    // Load ElevenLabs DIRECT catalog (Wati 16/06) — voix avec UUID + labels
    // descriptifs ("Jessica - Playful, Bright, Warm"). Necessite ELEVEN_API_KEY
    // sur Vercel. Renvoie {voices:[], note:...} si absent.
    fetch("/api/voices/elevenlabs")
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.voices) ? data.voices : [];
        // Construit 2 entries pour chaque voix : une Flash, une Turbo.
        const direct: ReplicateVoiceCatalog[] = [];
        for (const v of list) {
          const label = v.description
            ? `${v.name} - ${v.description}`
            : v.name;
          direct.push({
            id: `elevenlabs:flash:${v.voice_id}`,
            name: `${label} (Flash)`,
            description: v.description ?? null,
            language: v.language ?? null,
            gender: v.gender ?? null,
            is_public: v.category === "premade",
            family: "elevenlabs-flash-direct",
          });
          direct.push({
            id: `elevenlabs:turbo:${v.voice_id}`,
            name: `${label} (Turbo)`,
            description: v.description ?? null,
            language: v.language ?? null,
            gender: v.gender ?? null,
            is_public: v.category === "premade",
            family: "elevenlabs-turbo-direct",
          });
        }
        // Fusionne avec le catalogue Replicate existant (MiniMax surtout).
        setReplicateVoices((prev) => {
          const withoutOldDirect = prev.filter(
            (v) => v.family !== "elevenlabs-flash-direct" && v.family !== "elevenlabs-turbo-direct",
          );
          return [...direct, ...withoutOldDirect];
        });
      })
      .catch(() => {});
    // Load MiniMax DIRECT catalog (Wati 16/06) — voix system (17 préréglées
    // Speech 02) + voix clonées sur le compte. Renvoie {voices:[], note:...}
    // si MINIMAX_API_KEY/GROUP_ID absentes. Format voice_id renvoyé :
    // "minimax:speech-02-turbo:<voice>" ou "minimax:speech-02-hd:<voice>".
    fetch("/api/voices/minimax")
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.voices) ? data.voices : [];
        const direct: ReplicateVoiceCatalog[] = list.map((v: {
          voice_id: string;
          name: string;
          description: string | null;
          gender: string | null;
          language: string | null;
          family: string;
          category: string;
        }) => ({
          id: v.voice_id,
          name: v.description ? `${v.name} — ${v.description}` : v.name,
          description: v.description,
          language: v.language,
          gender: v.gender,
          is_public: v.category === "system",
          family: `${v.family}-direct`, // "minimax-turbo-direct" | "minimax-hd-direct"
        }));
        setReplicateVoices((prev) => {
          const withoutOldMinimaxDirect = prev.filter(
            (v) => v.family !== "minimax-turbo-direct" && v.family !== "minimax-hd-direct",
          );
          return [...withoutOldMinimaxDirect, ...direct];
        });
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
        setError("Could not parse the .md file.");
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
      tts_emotion: ttsEmotion || null,
      tts_speed: speed,
      tts_volume: volume,
      tts_pitch: pitch,
      tts_model: ttsModel || null,
      tts_stability: stability,
      tts_similarity_boost: similarityBoost,
      tts_style: styleVal,
      tts_speaker_boost: speakerBoost,
      tts_language: ttsLanguage || null,
      tts_english_normalization: englishNorm,
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
    if (!confirm(`Delete agent "${initial.name}"? This action is irreversible.`)) return;
    setBusy(true);
    const res = await fetch(`/api/agents/${initial.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Deletion failed");
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
          model: ttsModel || "sonic-3.5",
          speed: speed !== 1.0 ? speed : undefined,
          language: CARTESIA_LANGUAGE[language] ?? undefined,
          // Send the agent's REAL ElevenLabs voice settings so the preview
          // matches the live call (ignored by non-ElevenLabs voices).
          stability: stability ?? undefined,
          similarity_boost: similarityBoost ?? undefined,
          style: styleVal ?? undefined,
          use_speaker_boost: speakerBoost,
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

  // Fallback to [] so an agent whose llm_provider isn't in PROVIDER_MODELS
  // (e.g. a value added on the worker before the UI knew about it) renders the
  // dropdown via the "(personnalisé)" option instead of crashing on .map().
  const llmModels = PROVIDER_MODELS[provider] ?? [];

  // ── Voice catalog (from API + cloned in Supabase) ──────────────────────
  const customCloned = voices.filter((v) => v.source === "cloned");
  const customPresets = voices.filter((v) => v.source === "preset");

  // Derive filter options from catalog data (Cartesia + Replicate fusionnes).
  const catalogLangs = [
    ...new Set([
      ...(cartesiaVoices.map((v) => v.language).filter(Boolean) as string[]),
      ...(replicateVoices.map((v) => v.language).filter(Boolean) as string[]),
    ]),
  ].sort();
  const catalogGenders = [
    ...new Set([
      ...(cartesiaVoices.map((v) => normalizeGender(v.gender)).filter(Boolean) as string[]),
      ...(replicateVoices.map((v) => normalizeGender(v.gender)).filter(Boolean) as string[]),
    ]),
  ].sort();
  const catalogCountries = [...new Set(cartesiaVoices.map((v) => v.country).filter(Boolean) as string[])].sort();

  // Apply active filters (provider Cartesia uniquement, on cache si le filtre
  // demande explicitement une famille Replicate).
  const filteredCatalog = (filterProvider && filterProvider !== "cartesia")
    ? []
    : cartesiaVoices.filter((v) => {
        if (filterLang && v.language !== filterLang) return false;
        if (filterGender && normalizeGender(v.gender) !== filterGender) return false;
        if (filterCountry && v.country !== filterCountry) return false;
        return true;
      });

  // Group filtered catalog by language (Cartesia).
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

  // Replicate : meme logique de filtrage + filtre famille (Wati 15/06).
  // Si filterProvider est "cartesia" → on cache toutes les Replicate.
  // Si filterProvider est une famille Replicate → on garde que cette famille.
  const filteredReplicate = (filterProvider === "cartesia")
    ? []
    : replicateVoices.filter((v) => {
        if (filterProvider && filterProvider !== v.family) return false;
        // Voices with no declared language (e.g. MiniMax system voices, which
        // are multilingual) must NOT be hidden by a language filter — only
        // exclude a voice that HAS a language and it doesn't match.
        if (filterLang && v.language && v.language !== filterLang) return false;
        if (filterGender && normalizeGender(v.gender) !== filterGender) return false;
        return true;
      });
  const replicateGroups: [string, ReplicateVoiceCatalog[]][] = (() => {
    const map = new Map<string, ReplicateVoiceCatalog[]>();
    for (const v of filteredReplicate) {
      const fam = v.family;
      const list = map.get(fam) ?? [];
      list.push(v);
      map.set(fam, list);
    }
    // Ordre fixe : ElevenLabs direct (Flash, Turbo) puis MiniMax.
    const order = ["elevenlabs-flash-direct", "elevenlabs-turbo-direct", "minimax-turbo-direct", "minimax-hd-direct"];
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  })();

  const knownVoiceIds = new Set<string>([
    ...cartesiaVoices.map((v) => v.id),
    ...replicateVoices.map((v) => v.id),
    ...customCloned.map((v) => v.voice_id),
    ...customPresets.map((v) => v.voice_id),
  ]);

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Import a persona <span className="kbd">.md</span> to fill this form, or export the current configuration.
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
            ⬆ Import .md
          </button>
          <button type="button" className="ghost" onClick={onExportMd}>
            ⬇ Export .md
          </button>
          <Link href="/agents/library">
            <button type="button" className="ghost">
              ⊕ Library
            </button>
          </Link>
        </div>
      </div>

      {/* ─── Tab bar (grouped by concept) ─── */}
      <div style={{ display: "flex", gap: 4 }}>
        {([
          { id: "identity", label: "🪪 Identity" },
          { id: "voice", label: "🎙️ Voice" },
          { id: "brain", label: "🧠 Brain & behavior" },
        ] as const).map((tab_item) => (
          <button
            key={tab_item.id}
            type="button"
            onClick={() => setTab(tab_item.id)}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: tab === tab_item.id ? 600 : 400,
              background: tab === tab_item.id ? "var(--surface-2, rgba(255,255,255,0.06))" : "transparent",
              color: tab === tab_item.id ? "var(--fg)" : "var(--muted)",
              border: "none",
              borderBottom: tab === tab_item.id ? "2px solid var(--accent, #ff6b35)" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {tab_item.label}
          </button>
        ))}
      </div>

      {/* ═══ IDENTITÉ : qui est l'agent ═══ */}
      {tab === "identity" && (
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Identity</h3>
          <div className="form-row">
            <div>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Tibok receptionist" />
            </div>
            <div>
              <label>Primary language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" />
          </div>
        </div>
      )}

      {/* ═══ VOIX : comment l'agent sonne (tout le voice ici) ═══ */}
      {tab === "voice" && (
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Voice</h3>

          <div>
            <label>Agent voice</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="">— default voice —</option>
              {customCloned.length > 0 && (
                <optgroup label="My cloned voices">
                  {customCloned.map((v) => (
                    <option key={v.id} value={v.voice_id}>{v.display_name}</option>
                  ))}
                </optgroup>
              )}
              {customPresets.length > 0 && (
                <optgroup label="Preset voices">
                  {customPresets.map((v) => (
                    <option key={v.id} value={v.voice_id}>{v.display_name}</option>
                  ))}
                </optgroup>
              )}
              {catalogGroups.length > 0 && (
                <optgroup label="━━━ Cartesia ━━━" disabled>
                  <option value="" disabled>↓ Cartesia voices (cloned + catalog)</option>
                </optgroup>
              )}
              {catalogGroups.map(([lang, options]) => (
                <optgroup key={`cartesia-${lang}`} label={`Cartesia · ${LANG_NAMES[lang] ?? lang.toUpperCase()}`}>
                  {options.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.gender ? ` (${GENDER_LABELS[normalizeGender(v.gender) ?? v.gender] ?? v.gender})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
              {replicateGroups.length > 0 && (
                <optgroup label="━━━ ElevenLabs / MiniMax ━━━" disabled>
                  <option value="" disabled>↓ Premium streaming voices</option>
                </optgroup>
              )}
              {replicateGroups.map(([fam, options]) => (
                <optgroup key={`replicate-${fam}`} label={REPLICATE_FAMILY_LABELS[fam] ?? fam}>
                  {options.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.gender ? ` (${GENDER_LABELS[normalizeGender(v.gender) ?? v.gender] ?? v.gender})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
              {cartesiaVoices.length === 0 && replicateVoices.length === 0 && (
                <option value="" disabled>Voice catalog not available (API key missing)</option>
              )}
              {voice && !knownVoiceIds.has(voice) && (
                <option value={voice}>{voice} (ID manuel)</option>
              )}
            </select>

            {/* Horizontal filter bar — below the dropdown, like Cartesia's UI */}
            {(cartesiaVoices.length > 0 || replicateVoices.length > 0) && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                {/* Filtre fournisseur (Wati 15/06) — premier filtre car le plus
                    selectif : ramene 881 voix a quelques dizaines en un clic. */}
                {replicateVoices.length > 0 && (
                  <select
                    value={filterProvider}
                    onChange={(e) => setFilterProvider(e.target.value)}
                    style={{ width: "auto", fontSize: 13, padding: "6px 12px", borderRadius: 20, background: "var(--bg-2)", color: "var(--text)", fontWeight: filterProvider ? 600 : 400 }}
                  >
                    <option value="" style={{ background: "var(--bg-2)", color: "var(--text)" }}>{t("Tous les fournisseurs")}</option>
                    <option value="cartesia" style={{ background: "var(--bg-2)", color: "var(--text)" }}>Cartesia ({cartesiaVoices.length})</option>
                    <option value="elevenlabs-flash-direct" style={{ background: "var(--bg-2)", color: "var(--text)" }}>ElevenLabs Flash v2.5 — latency ~75ms ({replicateVoices.filter((v) => v.family === "elevenlabs-flash-direct").length})</option>
                    <option value="elevenlabs-turbo-direct" style={{ background: "var(--bg-2)", color: "var(--text)" }}>ElevenLabs Turbo v2.5 — equivalent quality, latency ~100ms ({replicateVoices.filter((v) => v.family === "elevenlabs-turbo-direct").length})</option>
                    <option value="minimax-turbo-direct" style={{ background: "var(--bg-2)", color: "var(--text)" }}>MiniMax Speech 02 Turbo ({replicateVoices.filter((v) => v.family === "minimax-turbo-direct").length})</option>
                    <option value="minimax-hd-direct" style={{ background: "var(--bg-2)", color: "var(--text)" }}>MiniMax Speech 02 HD ({replicateVoices.filter((v) => v.family === "minimax-hd-direct").length})</option>
                  </select>
                )}
                <select
                  value={filterGender}
                  onChange={(e) => setFilterGender(e.target.value)}
                  style={{ width: "auto", fontSize: 13, padding: "6px 12px", borderRadius: 20, background: "var(--bg-2)", color: "var(--text)" }}
                >
                  <option value="" style={{ background: "var(--bg-2)", color: "var(--text)" }}>All genders</option>
                  {catalogGenders.map((g) => (
                    <option key={g} value={g} style={{ background: "var(--bg-2)", color: "var(--text)" }}>{GENDER_LABELS[g] ?? g}</option>
                  ))}
                </select>
                <select
                  value={filterLang}
                  onChange={(e) => setFilterLang(e.target.value)}
                  style={{ width: "auto", fontSize: 13, padding: "6px 12px", borderRadius: 20, background: "var(--bg-2)", color: "var(--text)" }}
                >
                  <option value="" style={{ background: "var(--bg-2)", color: "var(--text)" }}>All languages</option>
                  {catalogLangs.map((l) => (
                    <option key={l} value={l} style={{ background: "var(--bg-2)", color: "var(--text)" }}>{LANG_NAMES[l] ?? l.toUpperCase()}</option>
                  ))}
                </select>
                <select
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                  style={{ width: "auto", fontSize: 13, padding: "6px 12px", borderRadius: 20, background: "var(--bg-2)", color: "var(--text)" }}
                >
                  <option value="" style={{ background: "var(--bg-2)", color: "var(--text)" }}>All accents</option>
                  {catalogCountries.map((c) => (
                    <option key={c} value={c} style={{ background: "var(--bg-2)", color: "var(--text)" }}>{COUNTRY_LABELS[c] ?? c}</option>
                  ))}
                </select>
                {(filterLang || filterGender || filterCountry || filterProvider) && (
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: 12, padding: "6px 12px", borderRadius: 20 }}
                    onClick={() => { setFilterLang(""); setFilterGender(""); setFilterCountry(""); setFilterProvider(""); }}
                  >
                    ✕ Clear
                  </button>
                )}
                <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>
                  {filteredCatalog.length + filteredReplicate.length} voices
                </span>
              </div>
            )}
          </div>

          {/* Manual UUID entry */}
          <div>
            <label>Manual voice ID (UUID)</label>
            <input
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              placeholder="ex: a0e99841-438c-4a64-b679-ae501e7d6091"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              Paste the UUID of a specific voice here.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="ghost" disabled={previewing} onClick={onPreviewVoice}>
              {previewing ? "Synthesizing…" : "▶ Listen to this voice"}
            </button>
            <button type="button" className="ghost" onClick={() => setShowClone((v) => !v)}>
              {showClone ? "Cancel cloning" : "+ Clone a new voice"}
            </button>
          </div>

          {/* Inline voice cloning via Cartesia /voices/clone. */}
          {showClone && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Instant voice cloning. Sample <strong>mp3 / wav / m4a</strong>,
                single voice, 5 s to 5 min, ≤ 20 MB. The voice will be available immediately in the catalog.
              </div>
              <div className="form-row">
                <div>
                  <label>Audio file</label>
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f && !/\.(mp3|wav|m4a)$/i.test(f.name)) {
                        setError(`Unsupported format: "${f.name}". Use mp3, wav or m4a.`);
                        e.target.value = "";
                        setCloneFile(null);
                        return;
                      }
                      setCloneFile(f);
                    }}
                  />
                  {cloneFile && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      {cloneFile.name} ({(cloneFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
                <div>
                  <label>Display name</label>
                  <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="Dr Coste voice" />
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={doClone}
                  disabled={cloning || !cloneFile || !cloneName.trim()}
                >
                  {cloning ? "Cloning…" : "Clone and use this voice"}
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
              ⚙ Advanced settings (TTS model, speed, volume)
            </button>
            {showVoiceAdvanced && (
              <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                {/* Detection du fournisseur (Wati 15/06) : adapte les
                    reglages avances au moteur derriere la voix selectionnee.
                    voice_id "replicate:elevenlabs-flash:..." → ElevenLabs Flash
                    voice_id "replicate:elevenlabs-turbo:..." → ElevenLabs Turbo
                    voice_id "replicate:minimax-turbo:..."    → MiniMax Turbo
                    voice_id "replicate:minimax-hd:..."       → MiniMax HD
                    sinon → Cartesia (defaut historique). */}
                {(() => {
                  // Detect family from voice_id prefix (Wati 16/06 :
                  // 'elevenlabs:flash:...' / 'elevenlabs:turbo:...' = direct,
                  // 'minimax:speech-02-turbo:...' / 'minimax:speech-02-hd:...' = direct,
                  // 'replicate:elevenlabs-...' = legacy via Replicate,
                  // 'replicate:minimax-...' = MiniMax via Replicate,
                  // sinon UUID Cartesia).
                  const isElevenLabsDirect = voice.startsWith("elevenlabs:");
                  const isMinimaxDirect = voice.startsWith("minimax:");
                  const isReplicate = voice.startsWith("replicate:");
                  const family = isElevenLabsDirect
                    ? `elevenlabs-${voice.split(":")[1] ?? "flash"}-direct`
                    : isMinimaxDirect
                    ? (voice.split(":")[1] === "speech-02-hd" ? "minimax-hd-direct" : "minimax-turbo-direct")
                    : isReplicate
                    ? voice.split(":")[1] ?? ""
                    : "cartesia";
                  const isElevenLabs = family.startsWith("elevenlabs");
                  const isMiniMax = family.startsWith("minimax");
                  const isExternal = isElevenLabsDirect || isMinimaxDirect || isReplicate;
                  const familyLabel =
                    family === "cartesia" ? "Cartesia Sonic" :
                    family === "elevenlabs-flash-direct" ? "ElevenLabs Flash v2.5 (direct, ~75ms TTFB)" :
                    family === "elevenlabs-turbo-direct" ? "ElevenLabs Turbo v2.5 (direct, ~100ms TTFB)" :
                    family === "elevenlabs-flash" ? "ElevenLabs Flash v2.5 (via Replicate, legacy)" :
                    family === "elevenlabs-turbo" ? "ElevenLabs Turbo v2.5 (via Replicate, legacy)" :
                    family === "minimax-turbo-direct" ? "MiniMax Speech 02 Turbo (direct, ~400ms TTFB)" :
                    family === "minimax-hd-direct" ? "MiniMax Speech 02 HD (direct, streaming SSE)" :
                    family === "minimax-turbo" ? "MiniMax Speech 02 Turbo (via Replicate, legacy)" :
                    family === "minimax-hd" ? "MiniMax Speech 02 HD (via Replicate, legacy)" :
                    "Cartesia Sonic";
                  return (
                    <>
                      {/* Modele TTS : dropdown sonic-3.5/sonic-3 uniquement
                          pour Cartesia. Pour les autres fournisseurs, le
                          modele est encode dans le voice_id (familyLabel),
                          on l'affiche en lecture seule. */}
                      {!isExternal ? (
                        <div>
                          <label>TTS model</label>
                          <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)}>
                            {TTS_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label>TTS model</label>
                          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--bg-2)", color: "var(--muted)", fontSize: 13 }}>
                            <strong style={{ color: "var(--text)" }}>{familyLabel}</strong>
                            <span> — fixed by the selected voice, not editable</span>
                          </div>
                        </div>
                      )}
                      <div className="form-row">
                        {/* Vitesse — plages par fournisseur :
                              Cartesia  : 0.6 - 1.5
                              MiniMax   : 0.5 - 2.0 (champ speed)
                              ElevenLabs: 0.7 - 1.2 (voice_settings.speed) */}
                        <div>
                          <label>Speed ({speed.toFixed(2)}×)</label>
                          <input
                            type="range"
                            min={isMiniMax ? "0.5" : isElevenLabs ? "0.7" : "0.6"}
                            max={isMiniMax ? "2" : isElevenLabs ? "1.2" : "1.5"}
                            step="0.05"
                            value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
                          />
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            {isMiniMax ? "MiniMax range: 0.5×–2.0×" : isElevenLabs ? "ElevenLabs range: 0.7×–1.2×" : "Cartesia range: 0.6×–1.5×"}
                          </div>
                        </div>
                        {!isElevenLabs ? (
                          <div>
                            <label>Volume ({volume.toFixed(1)})</label>
                            <input
                              type="range"
                              min={isMiniMax ? "0" : "0.1"}
                              max={isMiniMax ? "10" : "2"}
                              step={isMiniMax ? "0.5" : "0.1"}
                              value={volume} onChange={(e) => setVolume(Number(e.target.value))}
                            />
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              {isMiniMax ? "MiniMax range: 0–10" : "Cartesia range: 0.1–2.0"}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <label>Volume</label>
                            <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--bg-2)", color: "var(--muted)", fontSize: 13 }}>
                              Not exposed by ElevenLabs (use stability / style instead)
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Cartesia : émotion + langue forcée ───────────── */}
                      {family === "cartesia" && (
                        <>
                          <div className="form-row">
                            <div>
                              <label>Emotion (Cartesia)</label>
                              <select
                                value={ttsEmotion}
                                onChange={(e) => setTtsEmotion(e.target.value)}
                              >
                                <option value="">None (neutral)</option>
                                <option value="positivity">Positivity (warm)</option>
                                <option value="curiosity">Curiosity (interested)</option>
                                <option value="sadness">Sadness (sad)</option>
                                <option value="anger">Anger (angry)</option>
                                <option value="surprise">Surprise (surprised)</option>
                              </select>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Modulates the affective tone of the Sonic model.
                              </div>
                            </div>
                            <div>
                              <label>Forced language</label>
                              <select
                                value={ttsLanguage}
                                onChange={(e) => setTtsLanguage(e.target.value)}
                              >
                                <option value="">Auto (from text)</option>
                                <option value="fr">French</option>
                                <option value="en">English</option>
                                <option value="es">Spanish</option>
                                <option value="de">German</option>
                                <option value="it">Italian</option>
                                <option value="pt">Portuguese</option>
                                <option value="nl">Dutch</option>
                              </select>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Forces Cartesia to synthesize in this language (useful in multilingual mode).
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ── ElevenLabs : stability/similarity/style/speaker boost ── */}
                      {isElevenLabs && (
                        <>
                          <div className="form-row">
                            <div>
                              <label>
                                Stability ({stability === null ? "default 0.5" : stability.toFixed(2)})
                              </label>
                              <input
                                type="range" min="0" max="1" step="0.05"
                                value={stability ?? 0.5}
                                onChange={(e) => setStability(Number(e.target.value))}
                              />
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Low = expressive/variable · High = stable/monotone
                              </div>
                            </div>
                            <div>
                              <label>
                                Similarity boost ({similarityBoost === null ? "default 0.75" : similarityBoost.toFixed(2)})
                              </label>
                              <input
                                type="range" min="0" max="1" step="0.05"
                                value={similarityBoost ?? 0.75}
                                onChange={(e) => setSimilarityBoost(Number(e.target.value))}
                              />
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Fidelity to the original voice (cloning).
                              </div>
                            </div>
                          </div>
                          <div className="form-row">
                            <div>
                              <label>
                                Style ({styleVal === null ? "default 0" : styleVal.toFixed(2)})
                              </label>
                              <input
                                type="range" min="0" max="1" step="0.05"
                                value={styleVal ?? 0}
                                onChange={(e) => setStyleVal(Number(e.target.value))}
                              />
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Style exaggeration (&gt;0 increases latency).
                              </div>
                            </div>
                            <div>
                              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={speakerBoost}
                                  onChange={(e) => setSpeakerBoost(e.target.checked)}
                                />
                                Speaker boost
                              </label>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Amplifies similarity at the cost of a slight latency increase.
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ── MiniMax : pitch + émotion + english_normalization ── */}
                      {isMiniMax && (
                        <>
                          <div className="form-row">
                            <div>
                              <label>Pitch ({pitch > 0 ? "+" : ""}{pitch})</label>
                              <input
                                type="range" min="-12" max="12" step="1"
                                value={pitch}
                                onChange={(e) => setPitch(Number(e.target.value))}
                              />
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                Semitone shift: -12 low · +12 high (MiniMax).
                              </div>
                            </div>
                            <div>
                              <label>Emotion (MiniMax)</label>
                              <select
                                value={ttsEmotion}
                                onChange={(e) => setTtsEmotion(e.target.value)}
                              >
                                <option value="">None (neutral)</option>
                                <option value="happy">Happy</option>
                                <option value="sad">Sad</option>
                                <option value="angry">Angry</option>
                                <option value="fearful">Fearful</option>
                                <option value="disgusted">Disgusted</option>
                                <option value="surprised">Surprised</option>
                                <option value="calm">Calm</option>
                                <option value="neutral">Neutral</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={englishNorm}
                                onChange={(e) => setEnglishNorm(e.target.checked)}
                              />
                              English normalization
                            </label>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              Normalizes numbers/dates/symbols in English (recommended if the agent speaks English).
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
                <div>
                  <label>Style &amp; tone (LLM instruction)</label>
                  <textarea
                    rows={2}
                    value={voiceStyle}
                    onChange={(e) => setVoiceStyle(e.target.value)}
                    placeholder="Ex: warm and reassuring, calm pace, smile in the voice, never rushed."
                  />
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    Injected into the agent&apos;s instructions — guides how it phrases things (complements TTS emotion).
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ CERVEAU & COMPORTEMENT : comment l'agent pense/parle ═══ */}
      {tab === "brain" && (
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Brain &amp; behavior</h3>
          <div>
            <label>Session greeting</label>
            <input value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </div>
          <PromptEditor
            agentId={initial?.id}
            value={systemPrompt}
            onChange={setSystemPrompt}
            greeting={greeting}
            onRestoreGreeting={setGreeting}
            placeholder="You are a voice assistant for Tibok pharmacy. You speak French and English. You can..."
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
              ⚙ Advanced settings (LLM model, knowledge base)
            </button>
            {showBrainAdvanced && (
              <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                <div className="form-row">
                  <div>
                    <label>LLM Provider</label>
                    <select value={provider} onChange={(e) => {
                      const p = e.target.value as LlmProvider;
                      setProvider(p);
                      const first = PROVIDER_MODELS[p]?.[0];
                      if (first) setModel(first.id);
                    }}>
                      <option value="deepseek">DeepSeek (recommended)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic Claude</option>
                    </select>
                  </div>
                  <div>
                    <label>Model</label>
                    <select value={model} onChange={(e) => setModel(e.target.value)}>
                      {llmModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      {!llmModels.some((m) => m.id === model) && <option value={model}>{model} (custom)</option>}
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
                    Knowledge base (RAG)
                  </label>
                  <div>
                    <label>Top-K passages to inject</label>
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

      {initial?.id && <AgentNumbersSection agentId={initial.id} />}

      <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
        <button type="submit" disabled={busy || !name}>
          {busy ? "…" : initial ? "Save" : "Create agent"}
        </button>
        {initial && (
          <button type="button" className="danger" onClick={onDelete} disabled={busy}>
            Delete agent
          </button>
        )}
      </div>
    </form>
  );
}
