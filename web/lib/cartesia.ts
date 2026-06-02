/**
 * Cartesia helpers — voice list, TTS preview, voice cloning.
 * Docs: https://docs.cartesia.ai/
 *
 * All functions throw on failure so callers can surface the error.
 */

import { cfg } from "./config";

const CARTESIA_VERSION = "2025-04-16";

function cartesiaBase(): string {
  return cfg.cartesia.baseUrl.replace(/\/$/, "");
}

function cartesiaKey(): string {
  const key = cfg.cartesia.apiKey;
  if (!key) throw new Error("CARTESIA_API_KEY missing");
  return key;
}

function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${cartesiaKey()}`,
    "Cartesia-Version": CARTESIA_VERSION,
    "Content-Type": "application/json",
  };
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${cartesiaKey()}`,
    "Cartesia-Version": CARTESIA_VERSION,
  };
}

export interface CartesiaVoice {
  id: string;
  name: string;
  description: string | null;
  language: string | null;
  gender: string | null;
  is_public: boolean;
  created_at: string | null;
}

/** GET /voices — returns every voice the API key can access. */
export async function listCartesiaVoices(): Promise<CartesiaVoice[]> {
  const r = await fetch(`${cartesiaBase()}/voices`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`Cartesia /voices failed: HTTP ${r.status}`);
  const data = await r.json();
  // API returns the array directly (or wrapped in { voices: [...] }).
  return Array.isArray(data) ? data : (data.voices ?? []);
}

/**
 * POST /tts/bytes — synthesize a short clip for preview.
 * Returns raw MP3 bytes for browser playback.
 */
export async function previewCartesiaTTS(opts: {
  voice_id: string;
  text: string;
  model?: string;
  language?: string;
  speed?: number;
  emotion?: string;
}): Promise<{ audio: ArrayBuffer; format: string }> {
  const model = opts.model || "sonic-3";
  const body: Record<string, unknown> = {
    model_id: model,
    transcript: opts.text,
    voice: { mode: "id", id: opts.voice_id },
    output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 },
  };
  if (opts.language) body.language = opts.language;
  if (opts.speed !== undefined && opts.speed !== 1.0) body.speed = opts.speed;
  if (opts.emotion) body.emotion = [opts.emotion];

  const r = await fetch(`${cartesiaBase()}/tts/bytes`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "unknown");
    throw new Error(`Cartesia TTS failed: HTTP ${r.status} — ${msg}`);
  }
  return { audio: await r.arrayBuffer(), format: "audio/mpeg" };
}

/**
 * POST /voices/clone — instant voice cloning from an audio clip.
 * Returns the new Cartesia voice ID (UUID) for storage in Supabase.
 */
export async function cloneCartesiaVoice(opts: {
  file: File;
  name: string;
  description?: string;
  language: string;
}): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.set("clip", opts.file);
  form.set("name", opts.name);
  form.set("description", opts.description ?? "");
  form.set("language", opts.language === "multi" ? "fr" : opts.language);
  form.set("mode", "similarity");

  const r = await fetch(`${cartesiaBase()}/voices/clone`, {
    method: "POST",
    headers: authHeaders(), // no Content-Type — browser sets multipart boundary
    body: form,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "unknown");
    throw new Error(`Cartesia clone failed: HTTP ${r.status} — ${msg}`);
  }
  const voice = (await r.json()) as { id: string; name: string };
  return { id: voice.id, name: voice.name };
}
