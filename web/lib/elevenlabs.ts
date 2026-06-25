// ElevenLabs DIRECT — preview TTS (Wati 16/06).
//
// Permet le bouton ▶️ "Écouter cette voix" dans l'AgentForm de generer un
// echantillon pour les voice_id au format "elevenlabs:<family>:<voice>".
//
// On tape directement l'API ElevenLabs (pas via Replicate). Streaming non
// utilise ici (POST classique suffit pour un court extrait de preview),
// mais le worker en runtime utilise le plugin LiveKit ElevenLabs avec
// WebSocket streaming pour ~75ms TTFB.

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

const FAMILY_TO_MODEL: Record<string, string> = {
  flash: "eleven_flash_v2_5",
  turbo: "eleven_turbo_v2_5",
  multilingual: "eleven_multilingual_v2",
};

export async function previewElevenLabsTTS(opts: {
  voice_id: string; // "elevenlabs:<family>:<voice>"
  text: string;
  speed?: number; // 0.7..1.2 (Flash/Turbo)
  // Wati 25/06 — mirror the per-agent voice settings the LIVE telephony call
  // uses (agent/elevenlabs_tts.py) so the studio preview = what patients hear.
  stability?: number | null;
  similarity_boost?: number | null;
  style?: number | null;
  use_speaker_boost?: boolean | null;
}): Promise<{ audio: ArrayBuffer; format: string }> {
  const apiKey =
    process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ELEVEN_API_KEY missing — ajouter la cle sur Vercel pour activer la preview ElevenLabs.",
    );
  }

  const parts = opts.voice_id.split(":", 3);
  if (parts.length !== 3 || parts[0] !== "elevenlabs") {
    throw new Error(`voice_id ElevenLabs invalide: ${opts.voice_id}`);
  }
  const family = parts[1];
  const voiceRef = parts[2];
  const model = FAMILY_TO_MODEL[family] ?? "eleven_flash_v2_5";

  // ElevenLabs accepte soit un voice_id UUID, soit un nom de voix.
  // On laisse passer ce que le caller donne — l'API resout les 2.
  const url = `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceRef)}`;

  // Mirror the live telephony adapter so the preview reflects the real call.
  // null/undefined → ElevenLabs API defaults (same as the call gets when an
  // agent leaves a setting unset).
  const voiceSettings: Record<string, unknown> = {
    stability: opts.stability ?? 0.5,
    similarity_boost: opts.similarity_boost ?? 0.75,
  };
  if (opts.style != null) voiceSettings.style = opts.style;
  if (opts.use_speaker_boost != null) voiceSettings.use_speaker_boost = opts.use_speaker_boost;
  if (opts.speed && opts.speed !== 1.0) {
    // ElevenLabs Flash/Turbo : speed 0.7..1.2
    voiceSettings.speed = Math.max(0.7, Math.min(1.2, opts.speed));
  }
  const body: Record<string, unknown> = {
    text: opts.text,
    model_id: model,
    voice_settings: voiceSettings,
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => "");
    throw new Error(
      `ElevenLabs HTTP ${r.status}: ${errBody.slice(0, 300)}`,
    );
  }
  const audio = await r.arrayBuffer();
  return { audio, format: "audio/mpeg" };
}
