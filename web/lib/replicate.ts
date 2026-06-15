/**
 * Replicate helpers — voix ElevenLabs + MiniMax via la passerelle Replicate.
 *
 * Modèles utilisés (vérifiés public 15/06/2026) :
 *   • elevenlabs/flash-v2.5  — ElevenLabs Flash v2.5 (le plus rapide ~75ms TTFB)
 *   • elevenlabs/turbo-v2.5  — ElevenLabs Turbo v2.5 (meilleur naturel, 32 langues)
 *   • minimax/speech-02-turbo — MiniMax Speech 02 Turbo
 *   • minimax/speech-02-hd   — MiniMax Speech 02 HD
 *
 * Approche : on garde Cartesia côté code. Replicate s'AJOUTE comme provider.
 * Le compte Replicate de Wati est déjà dans REPLICATE_API_TOKEN (Vercel env).
 *
 * Toutes les fonctions throw si la clé manque — l'appelant remonte l'erreur.
 */

import { cfg } from "./config";

function replicateBase(): string {
  return cfg.replicate.baseUrl.replace(/\/$/, "");
}

function replicateKey(): string {
  const key = cfg.replicate.apiKey;
  if (!key) throw new Error("REPLICATE_API_TOKEN missing");
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${replicateKey()}`,
    "Content-Type": "application/json",
  };
}

// ─── Modèle de voix unifié exposé au front ───────────────────────────────────
// Le UI ne sait rien de Cartesia/Replicate — il manipule juste cette interface.
// `provider_voice_id` est ce qu'on stocke dans agents.tts_voice_id quand
// agents.tts_provider="replicate".
export interface ReplicateVoice {
  /** Identifiant unique global (préfixé par fournisseur pour éviter les collisions). */
  id: string;
  /** Nom affiché dans le dropdown. */
  name: string;
  /** Description courte / catégorie. */
  description: string | null;
  /** Code ISO 639-1 ou "multi" — null si inconnu. */
  language: string | null;
  /** "male" | "female" | "neutral" — null si inconnu. */
  gender: string | null;
  /** Toujours true ici (catalogue public d'ElevenLabs/MiniMax). */
  is_public: boolean;
  /** Modèle Replicate à appeler (ex: "elevenlabs/flash-v2.5"). */
  model: string;
  /** ID de voix à passer au modèle (champ voice_id côté ElevenLabs/MiniMax). */
  provider_voice_id: string;
  /** "elevenlabs-flash" | "elevenlabs-turbo" | "minimax-turbo" | "minimax-hd". */
  family: string;
}

// ─── ElevenLabs : catalogue public ───────────────────────────────────────────
// Les voice IDs ElevenLabs sont stables et publics — les mêmes qu'on passerait
// à l'API directe d'ElevenLabs. Liste sourcée du catalogue officiel ElevenLabs
// (https://elevenlabs.io/app/voice-library), restreinte aux voix les plus
// utilisées et de qualité éprouvée. Si Wati en veut d'autres on rajoute des
// lignes — c'est juste un tableau JS.
interface ElevenLabsVoiceSpec {
  voice_id: string;
  name: string;
  description: string;
  gender: "masculine" | "feminine" | "neutral";  // canonique = Cartesia (Wati 15/06)
  language: string; // "en" ou "multi"
}

const ELEVENLABS_VOICES: ElevenLabsVoiceSpec[] = [
  // Voix anglaises (catalogue par défaut ElevenLabs — disponibles pour tous)
  { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "American, calm, narration", gender: "feminine", language: "en" },
  { voice_id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", description: "American, strong, energetic", gender: "feminine", language: "en" },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "American, soft, young", gender: "feminine", language: "en" },
  { voice_id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "American, well-rounded, warm", gender: "masculine", language: "en" },
  { voice_id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", description: "American, emotional, expressive", gender: "feminine", language: "en" },
  { voice_id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", description: "American, deep, narrative", gender: "masculine", language: "en" },
  { voice_id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "American, crisp, authoritative", gender: "masculine", language: "en" },
  { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "American, deep, narration", gender: "masculine", language: "en" },
  { voice_id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", description: "American, raspy, dynamic", gender: "masculine", language: "en" },
  // British
  { voice_id: "ThT5KcBeYPX3keUQqHPh", name: "Dorothy", description: "British, pleasant, friendly", gender: "feminine", language: "en" },
  { voice_id: "g5CIjZEefAph4nQFvHAz", name: "Ethan", description: "American, whispery, intimate", gender: "masculine", language: "en" },
  { voice_id: "jBpfuIE2acCO8z3wKNLl", name: "Gigi", description: "American, childlike, cartoon", gender: "feminine", language: "en" },
  { voice_id: "jsCqWAovK2LkecY7zXl4", name: "Freya", description: "American, expressive, young", gender: "feminine", language: "en" },
  { voice_id: "oWAxZDx7w5VEj9dCyTzz", name: "Grace", description: "Southern US, gentle, mature", gender: "feminine", language: "en" },
  { voice_id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: "British, deep, authoritative", gender: "masculine", language: "en" },
  { voice_id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", description: "British, calm, warm", gender: "feminine", language: "en" },
  { voice_id: "piTKgcLEGmPE4e6mEKli", name: "Nicole", description: "American, whispery, soft", gender: "feminine", language: "en" },
  { voice_id: "pqHfZKP75CvOlQylNhV4", name: "Bill", description: "American, mature, narrative", gender: "masculine", language: "en" },
  { voice_id: "z9fAnlkpzviPz146aGWa", name: "Glinda", description: "American, witchy, character", gender: "feminine", language: "en" },
  { voice_id: "zcAOhNBS3c14rBihAFp1", name: "Giovanni", description: "Italian-accented English, foreign", gender: "masculine", language: "en" },
  // Multilingue (utilisable en FR + EN + 30 autres)
  { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", description: "Swedish, sultry, multilingual", gender: "feminine", language: "multi" },
  { voice_id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", description: "British, confident, multilingual", gender: "feminine", language: "multi" },
  { voice_id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", description: "American, warm, multilingual", gender: "feminine", language: "multi" },
  { voice_id: "bIHbv24MWmeRgasZH58o", name: "Will", description: "American, friendly, multilingual", gender: "masculine", language: "multi" },
  { voice_id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: "American, popular, multilingual", gender: "feminine", language: "multi" },
  { voice_id: "cjVigY5qzO86Huf0OWal", name: "Eric", description: "American, classy, multilingual", gender: "masculine", language: "multi" },
  { voice_id: "iP95p4xoKVk53GoZ742B", name: "Chris", description: "American, casual, multilingual", gender: "masculine", language: "multi" },
  { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "American, deep, multilingual", gender: "masculine", language: "multi" },
];

// ─── MiniMax : catalogue (sourcé de la doc MiniMax + dispo sur Replicate) ────
// Les IDs viennent de https://platform.minimax.io/docs/api-reference/audio
// Section "system voice list", colonne voice_id.
interface MiniMaxVoiceSpec {
  voice_id: string;
  name: string;
  description: string;
  gender: "masculine" | "feminine" | "neutral";  // canonique = Cartesia (Wati 15/06)
  language: string;
}

const MINIMAX_VOICES: MiniMaxVoiceSpec[] = [
  // Voix anglaises système MiniMax
  { voice_id: "English_ReservedYoungMan", name: "Reserved Young Man (EN)", description: "Calm young male voice", gender: "masculine", language: "en" },
  { voice_id: "English_Trustworth_Man", name: "Trustworthy Man (EN)", description: "Mature, authoritative male", gender: "masculine", language: "en" },
  { voice_id: "English_CalmWoman", name: "Calm Woman (EN)", description: "Soothing female voice", gender: "feminine", language: "en" },
  { voice_id: "English_UpsetGirl", name: "Upset Girl (EN)", description: "Expressive young female", gender: "feminine", language: "en" },
  { voice_id: "English_Gentle-voiced_man", name: "Gentle Man (EN)", description: "Soft-spoken male", gender: "masculine", language: "en" },
  { voice_id: "English_Graceful_Lady", name: "Graceful Lady (EN)", description: "Elegant mature female", gender: "feminine", language: "en" },
  { voice_id: "English_MaturePartner", name: "Mature Partner (EN)", description: "Reassuring adult male", gender: "masculine", language: "en" },
  { voice_id: "English_PassionateWarrior", name: "Passionate Warrior (EN)", description: "Energetic deep male", gender: "masculine", language: "en" },
  { voice_id: "English_WiseScholar", name: "Wise Scholar (EN)", description: "Thoughtful older male", gender: "masculine", language: "en" },
  { voice_id: "English_SoftFemale", name: "Soft Female (EN)", description: "Gentle warm female", gender: "feminine", language: "en" },
  // Multilingue
  { voice_id: "Wise_Woman", name: "Wise Woman", description: "Multilingual wise mature female", gender: "feminine", language: "multi" },
  { voice_id: "Friendly_Person", name: "Friendly Person", description: "Multilingual friendly neutral", gender: "neutral", language: "multi" },
  { voice_id: "Inspirational_girl", name: "Inspirational Girl", description: "Multilingual energetic female", gender: "feminine", language: "multi" },
  { voice_id: "Deep_Voice_Man", name: "Deep Voice Man", description: "Multilingual deep male", gender: "masculine", language: "multi" },
  { voice_id: "Calm_Woman", name: "Calm Woman", description: "Multilingual calm female", gender: "feminine", language: "multi" },
  { voice_id: "Casual_Guy", name: "Casual Guy", description: "Multilingual casual male", gender: "masculine", language: "multi" },
  { voice_id: "Lively_Girl", name: "Lively Girl", description: "Multilingual lively female", gender: "feminine", language: "multi" },
  { voice_id: "Patient_Man", name: "Patient Man", description: "Multilingual patient male", gender: "masculine", language: "multi" },
  { voice_id: "Young_Knight", name: "Young Knight", description: "Multilingual heroic male", gender: "masculine", language: "multi" },
  { voice_id: "Determined_Man", name: "Determined Man", description: "Multilingual firm male", gender: "masculine", language: "multi" },
  { voice_id: "Lovely_Girl", name: "Lovely Girl", description: "Multilingual sweet female", gender: "feminine", language: "multi" },
  { voice_id: "Decent_Boy", name: "Decent Boy", description: "Multilingual proper young male", gender: "masculine", language: "multi" },
  { voice_id: "Imposing_Manner", name: "Imposing Manner", description: "Multilingual commanding male", gender: "masculine", language: "multi" },
  { voice_id: "Elegant_Man", name: "Elegant Man", description: "Multilingual refined male", gender: "masculine", language: "multi" },
  { voice_id: "Abbess", name: "Abbess", description: "Multilingual mature female", gender: "feminine", language: "multi" },
  { voice_id: "Sweet_Girl_2", name: "Sweet Girl", description: "Multilingual sweet young female", gender: "feminine", language: "multi" },
  { voice_id: "Exuberant_Girl", name: "Exuberant Girl", description: "Multilingual energetic female", gender: "feminine", language: "multi" },
];

/**
 * Liste TOUTES les voix Replicate disponibles, regroupées par fournisseur.
 * Pas d'appel réseau : les catalogues sont statiques (et c'est le bon
 * comportement — Replicate n'expose pas d'endpoint "list voices" générique).
 */
export function listReplicateVoices(): ReplicateVoice[] {
  const all: ReplicateVoice[] = [];

  // ElevenLabs Flash v2.5
  for (const v of ELEVENLABS_VOICES) {
    all.push({
      id: `replicate:elevenlabs-flash:${v.voice_id}`,
      name: `${v.name} (Flash)`,
      description: v.description,
      language: v.language,
      gender: v.gender,
      is_public: true,
      model: "elevenlabs/flash-v2.5",
      provider_voice_id: v.voice_id,
      family: "elevenlabs-flash",
    });
  }
  // ElevenLabs Turbo v2.5
  for (const v of ELEVENLABS_VOICES) {
    all.push({
      id: `replicate:elevenlabs-turbo:${v.voice_id}`,
      name: `${v.name} (Turbo)`,
      description: v.description,
      language: v.language,
      gender: v.gender,
      is_public: true,
      model: "elevenlabs/turbo-v2.5",
      provider_voice_id: v.voice_id,
      family: "elevenlabs-turbo",
    });
  }
  // MiniMax Speech 02 Turbo
  for (const v of MINIMAX_VOICES) {
    all.push({
      id: `replicate:minimax-turbo:${v.voice_id}`,
      name: `${v.name} (MiniMax Turbo)`,
      description: v.description,
      language: v.language,
      gender: v.gender,
      is_public: true,
      model: "minimax/speech-02-turbo",
      provider_voice_id: v.voice_id,
      family: "minimax-turbo",
    });
  }
  // MiniMax Speech 02 HD
  for (const v of MINIMAX_VOICES) {
    all.push({
      id: `replicate:minimax-hd:${v.voice_id}`,
      name: `${v.name} (MiniMax HD)`,
      description: v.description,
      language: v.language,
      gender: v.gender,
      is_public: true,
      model: "minimax/speech-02-hd",
      provider_voice_id: v.voice_id,
      family: "minimax-hd",
    });
  }

  return all;
}

/**
 * Synthétise un court extrait pour preview (clic ▶️ dans le dropdown).
 *
 * Utilise l'API "predictions" de Replicate avec `Prefer: wait` qui bloque
 * jusqu'à completion (max 60s côté Replicate, après quoi on poll). Pour la
 * preview c'est OK — pour la vraie prod l'agent utilise un wrapper streaming
 * dédié (agent/replicate_tts.py).
 */
export async function previewReplicateTTS(opts: {
  voice_id: string; // id unifié "replicate:family:provider_voice_id"
  text: string;
  speed?: number; // 0.5..2.0
}): Promise<{ audio: ArrayBuffer; format: string }> {
  const voice = listReplicateVoices().find((v) => v.id === opts.voice_id);
  if (!voice) throw new Error(`Replicate voice unknown: ${opts.voice_id}`);

  const input = buildReplicateInput(voice, opts.text, opts.speed);

  // Replicate "official models" endpoint : POST /v1/models/{owner}/{name}/predictions
  // Le header Prefer: wait demande un retour synchrone (jusqu'à 60s).
  const url = `${replicateBase()}/models/${voice.model}/predictions`;
  const r = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), Prefer: "wait=60" },
    body: JSON.stringify({ input }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "unknown");
    throw new Error(`Replicate predictions HTTP ${r.status} — ${msg}`);
  }
  const pred = (await r.json()) as {
    status: string;
    output?: string | string[];
    urls?: { get?: string };
    error?: string;
  };
  let finalOutput = pred.output;
  // Si Replicate n'a pas tenu dans la fenêtre Prefer: wait, on poll get.
  if ((!finalOutput || pred.status !== "succeeded") && pred.urls?.get) {
    finalOutput = await pollReplicate(pred.urls.get);
  }
  if (pred.error) throw new Error(`Replicate error: ${pred.error}`);
  const audioUrl = Array.isArray(finalOutput) ? finalOutput[0] : finalOutput;
  if (!audioUrl) throw new Error("Replicate returned no audio URL");

  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
  const buf = await audioResp.arrayBuffer();
  // Replicate renvoie quasi systématiquement du MP3 pour TTS.
  return { audio: buf, format: audioResp.headers.get("content-type") || "audio/mpeg" };
}

function buildReplicateInput(
  voice: ReplicateVoice,
  text: string,
  speed?: number,
): Record<string, unknown> {
  // Champs spécifiques par famille — Replicate normalise tout mais chaque
  // modèle a son schéma d'entrée.
  if (voice.family.startsWith("elevenlabs")) {
    // ElevenLabs flash/turbo v2.5 sur Replicate attend "prompt" (pas "text").
    // Erreur Wati 15/06 : HTTP 422 "input: prompt is required".
    const input: Record<string, unknown> = {
      prompt: text,
      voice_id: voice.provider_voice_id,
    };
    if (speed && speed !== 1.0) {
      // ElevenLabs ne supporte pas un "speed" direct via Replicate, on l'ignore
      // côté preview pour éviter une erreur 422. Note Wati 15/06.
    }
    return input;
  }
  if (voice.family.startsWith("minimax")) {
    const input: Record<string, unknown> = {
      text,
      voice_id: voice.provider_voice_id,
    };
    if (speed && speed !== 1.0) {
      input.speed = Math.max(0.5, Math.min(2.0, speed));
    }
    return input;
  }
  return { text };
}

async function pollReplicate(getUrl: string, maxSecs = 30): Promise<string | string[] | undefined> {
  const deadline = Date.now() + maxSecs * 1000;
  while (Date.now() < deadline) {
    const r = await fetch(getUrl, { headers: authHeaders() });
    if (!r.ok) throw new Error(`Replicate poll HTTP ${r.status}`);
    const j = (await r.json()) as { status: string; output?: string | string[]; error?: string };
    if (j.status === "succeeded") return j.output;
    if (j.status === "failed" || j.status === "canceled") {
      throw new Error(`Replicate ${j.status}: ${j.error || "unknown"}`);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("Replicate poll timeout");
}
