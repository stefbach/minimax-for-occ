/**
 * MiniMax helpers — voice cloning + TTS preview.
 *
 * Voice clone flow (https://platform.minimax.io/docs/api-reference/voice-clone):
 *   1. POST /v1/files/upload  with multipart {file, purpose=voice_clone}
 *      → returns { file: { file_id }, base_resp: { status_code, status_msg } }
 *   2. POST /v1/voice_clone   with { file_id, voice_id, model, ... }
 *      → returns { base_resp: { status_code, status_msg } }
 *
 * MiniMax APIs habitually answer HTTP 200 with `base_resp.status_code != 0`
 * on errors, so checking r.ok is NOT enough — we always have to inspect
 * `base_resp` and surface the real status_msg.
 */

import { cfg } from "./config";

// Lazily read so importing this module never crashes at build time when the
// MiniMax env vars are unset (e.g. CI / preview deploys).
const minimaxBase = (): string => cfg.minimax.baseUrl.replace(/\/$/, "");

interface BaseResp {
  status_code?: number;
  status_msg?: string;
}

function authHeaders(): Record<string, string> {
  const key = cfg.minimax.apiKey;
  if (!key) throw new Error("MINIMAX_API_KEY missing");
  return { Authorization: `Bearer ${key}` };
}

function ensureBaseRespOk(json: { base_resp?: BaseResp }, label: string): void {
  const b = json.base_resp;
  if (!b) return; // some endpoints don't return base_resp
  const code = b.status_code;
  if (typeof code === "number" && code !== 0) {
    throw new Error(`MiniMax ${label} error ${code}: ${b.status_msg ?? "unknown"}`);
  }
}

function appendGroupId(url: string): string {
  const groupId = cfg.minimax.groupId;
  if (!groupId) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}GroupId=${encodeURIComponent(groupId)}`;
}

export async function uploadVoiceCloneSample(file: File): Promise<{ file_id: number | string }> {
  const form = new FormData();
  form.set("purpose", "voice_clone");
  form.set("file", file);

  const r = await fetch(appendGroupId(`${minimaxBase()}/files/upload`), {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!r.ok) {
    throw new Error(`MiniMax upload failed: HTTP ${r.status} — ${await r.text()}`);
  }
  const json = (await r.json()) as {
    file?: { file_id?: string | number };
    file_id?: string | number;
    base_resp?: BaseResp;
  };
  ensureBaseRespOk(json, "files/upload");
  const fileId = json.file?.file_id ?? json.file_id;
  if (fileId === undefined || fileId === null) {
    throw new Error(`MiniMax upload returned no file_id: ${JSON.stringify(json)}`);
  }
  // Preserve the original type. MiniMax /v1/voice_clone strictly type-checks
  // file_id as int64 — passing it back as a string ("12345" instead of 12345)
  // causes status_code=2013 "invalid params". When MiniMax returns the id as
  // a numeric string (legacy responses), parse it back to a number; otherwise
  // pass the number through untouched.
  const numeric = typeof fileId === "number" ? fileId : Number(fileId);
  return { file_id: Number.isFinite(numeric) ? numeric : (fileId as unknown as number) };
}

/**
 * Register a cloned voice on the user's MiniMax account.
 *
 * @param model the speech model the voice should be available for. Default
 *   "speech-02-hd" — the cloned voice is then usable by speech-02-hd /
 *   speech-02-turbo / speech-2.5-* and by every TTS plugin that targets the
 *   speech-02 family.
 */
export async function registerVoiceClone(opts: {
  file_id: number | string;
  voice_id: string;
  text?: string;
  model?: string;
}): Promise<unknown> {
  const r = await fetch(appendGroupId(`${minimaxBase()}/voice_clone`), {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      file_id: opts.file_id,
      voice_id: opts.voice_id,
      model: opts.model ?? "speech-02-hd",
      need_noise_reduction: true,
      need_volume_normalization: true,
      ...(opts.text ? { text: opts.text } : {}),
    }),
  });
  if (!r.ok) {
    throw new Error(`MiniMax voice_clone failed: HTTP ${r.status} — ${await r.text()}`);
  }
  const json = (await r.json().catch(() => ({}))) as { base_resp?: BaseResp };
  ensureBaseRespOk(json, "voice_clone");
  return json;
}

/**
 * Synthesize speech for a voice_id, return raw mp3/wav bytes for browser playback.
 */
export async function previewTTS(opts: {
  voice_id: string;
  text: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  emotion?: string;
  model?: string;
  language_boost?: string;
}): Promise<{ audio: ArrayBuffer; format: string }> {
  const url = appendGroupId(`${minimaxBase()}/t2a_v2`);

  // "fluent" emotion only exists on speech-2.6-* models — drop it otherwise
  // so the preview matches what the worker will actually do.
  const model = opts.model || "speech-02-hd";
  const emotion =
    opts.emotion && !(opts.emotion === "fluent" && !model.startsWith("speech-2.6"))
      ? opts.emotion
      : undefined;

  const body = {
    model,
    text: opts.text,
    voice_setting: {
      voice_id: opts.voice_id,
      speed: opts.speed ?? 1.0,
      vol: opts.vol ?? 1.0,
      pitch: opts.pitch ?? 0,
      ...(emotion ? { emotion } : {}),
    },
    audio_setting: {
      sample_rate: 24000,
      bitrate: 64000,
      format: "mp3",
      channel: 1,
    },
    ...(opts.language_boost ? { language_boost: opts.language_boost } : {}),
    output_format: "hex",
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`MiniMax TTS failed: HTTP ${r.status} — ${await r.text()}`);
  }
  const json = (await r.json()) as {
    data?: { audio?: string };
    base_resp?: BaseResp;
  };
  ensureBaseRespOk(json, "TTS");
  const hex = json.data?.audio;
  if (!hex) throw new Error("MiniMax TTS returned no audio (likely voice_id not registered yet — try in 30 s)");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return { audio: bytes.buffer, format: "audio/mpeg" };
}
