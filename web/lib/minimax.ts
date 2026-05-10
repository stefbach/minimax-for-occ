/**
 * MiniMax helpers — voice cloning + TTS preview.
 *
 * Voice clone flow (https://platform.minimax.io/docs/api-reference/voice-clone):
 *   1. POST /v1/files/upload  with multipart {file, purpose=voice_clone}
 *      → returns { file: { file_id } }
 *   2. POST /v1/voice_clone   with { file_id, voice_id }
 *      → registers the cloned voice on your account
 *
 * After step 2 the voice_id is usable in any TTS call.
 */

const MINIMAX_BASE = (process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/$/, "");
const GROUP_ID = process.env.MINIMAX_GROUP_ID; // optional, required for some TTS endpoints

function authHeaders(): Record<string, string> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("MINIMAX_API_KEY missing");
  return { Authorization: `Bearer ${key}` };
}

export async function uploadVoiceCloneSample(file: File): Promise<{ file_id: string }> {
  const form = new FormData();
  form.set("purpose", "voice_clone");
  form.set("file", file);

  const r = await fetch(`${MINIMAX_BASE}/files/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!r.ok) {
    throw new Error(`MiniMax upload failed: ${r.status} ${await r.text()}`);
  }
  const json = (await r.json()) as { file?: { file_id?: string }; file_id?: string };
  const fileId = json.file?.file_id ?? json.file_id;
  if (!fileId) throw new Error(`MiniMax upload returned no file_id: ${JSON.stringify(json)}`);
  return { file_id: String(fileId) };
}

export async function registerVoiceClone(opts: {
  file_id: string;
  voice_id: string;
  text?: string;
}): Promise<unknown> {
  const r = await fetch(`${MINIMAX_BASE}/voice_clone`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      file_id: opts.file_id,
      voice_id: opts.voice_id,
      text: opts.text,
    }),
  });
  if (!r.ok) {
    throw new Error(`MiniMax voice_clone failed: ${r.status} ${await r.text()}`);
  }
  return r.json().catch(() => ({}));
}

/**
 * Synthesize speech for a voice_id, return raw mp3/wav bytes for browser playback.
 * Uses the speech-02-turbo model (fast + multilingual). Caller is responsible
 * for setting the response Content-Type and streaming the body.
 */
export async function previewTTS(opts: {
  voice_id: string;
  text: string;
  speed?: number;
  emotion?: string;
  model?: string;
}): Promise<{ audio: ArrayBuffer; format: string }> {
  const url = GROUP_ID
    ? `${MINIMAX_BASE}/t2a_v2?GroupId=${encodeURIComponent(GROUP_ID)}`
    : `${MINIMAX_BASE}/t2a_v2`;

  const body = {
    model: opts.model || "speech-02-hd",
    text: opts.text,
    voice_setting: {
      voice_id: opts.voice_id,
      speed: opts.speed ?? 1.0,
      vol: 1.0,
      ...(opts.emotion ? { emotion: opts.emotion } : {}),
    },
    audio_setting: {
      sample_rate: 24000,
      bitrate: 64000,
      format: "mp3",
      channel: 1,
    },
    output_format: "hex",
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`MiniMax TTS failed: ${r.status} ${await r.text()}`);
  }
  const json = (await r.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (json.base_resp && json.base_resp.status_code && json.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax TTS error ${json.base_resp.status_code}: ${json.base_resp.status_msg ?? "unknown"}`,
    );
  }
  const hex = json.data?.audio;
  if (!hex) throw new Error("MiniMax TTS returned no audio");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return { audio: bytes.buffer, format: "audio/mpeg" };
}
