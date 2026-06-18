// MiniMax T2A v2 DIRECT — preview TTS (Wati 16/06).
//
// Powers the ▶ "Écouter cette voix" button in AgentForm for voice_ids
// shaped "minimax:<model>:<voice_id>". Calls MiniMax's REST endpoint
// directly (no Replicate hop). Non-streaming POST is enough for short
// preview clips ; the worker uses minimax_tts.py with SSE streaming
// for ~400ms TTFB during real calls.

const MINIMAX_DEFAULT_BASE = "https://api.minimax.io";
const SUPPORTED_MODELS = new Set(["speech-02-turbo", "speech-02-hd"]);

/** MiniMax API keys are JWTs whose payload carries the GroupID. Resolve the
 *  GroupID from MINIMAX_GROUP_ID if set, otherwise extract it from the
 *  MINIMAX_API_KEY JWT — so MiniMax works with just the key (no separate
 *  GROUP_ID), exactly like the original OCC setup. */
export function minimaxGroupId(): string | null {
  const explicit = process.env.MINIMAX_GROUP_ID;
  if (explicit) return explicit;
  const key = process.env.MINIMAX_API_KEY;
  if (!key || key.split(".").length !== 3) return null;
  try {
    let payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const gid = json.GroupID || json.GroupId || json.group_id;
    return gid ? String(gid) : null;
  } catch {
    return null;
  }
}

export async function previewMinimaxTTS(opts: {
  voice_id: string; // "minimax:<model>:<voice_id>"
  text: string;
  speed?: number;
  emotion?: string;
  pitch?: number;
  volume?: number;
  english_normalization?: boolean;
}): Promise<{ audio: ArrayBuffer; format: string }> {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = minimaxGroupId(); // optional on the current MiniMax API
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY missing — configure on Vercel pour activer la preview MiniMax.");
  }

  const parts = opts.voice_id.split(":", 3);
  if (parts.length !== 3 || parts[0] !== "minimax") {
    throw new Error(`voice_id MiniMax invalide: ${opts.voice_id}`);
  }
  const model = SUPPORTED_MODELS.has(parts[1]) ? parts[1] : "speech-02-turbo";
  const voiceRef = parts[2];

  const voiceSetting: Record<string, unknown> = { voice_id: voiceRef };
  if (opts.speed && opts.speed !== 1.0) {
    voiceSetting.speed = Math.max(0.5, Math.min(2.0, opts.speed));
  }
  if (opts.pitch !== undefined && opts.pitch !== 0) {
    voiceSetting.pitch = Math.max(-12, Math.min(12, Math.trunc(opts.pitch)));
  }
  if (opts.volume !== undefined && opts.volume !== 1.0) {
    voiceSetting.vol = Math.max(0.01, Math.min(10.0, opts.volume));
  }
  if (opts.emotion) voiceSetting.emotion = opts.emotion;
  if (opts.english_normalization !== undefined) {
    voiceSetting.english_normalization = opts.english_normalization;
  }

  const base = (process.env.MINIMAX_BASE_URL || MINIMAX_DEFAULT_BASE).replace(/\/+$/, "");
  const url = groupId
    ? `${base}/v1/t2a_v2?GroupId=${encodeURIComponent(groupId)}`
    : `${base}/v1/t2a_v2`;
  const body = {
    model,
    text: opts.text,
    stream: false,
    voice_setting: voiceSetting,
    audio_setting: { sample_rate: 24000, bitrate: 128000, format: "mp3", channel: 1 },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => "");
    throw new Error(`MiniMax HTTP ${r.status}: ${errBody.slice(0, 300)}`);
  }
  const data = (await r.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax error ${data.base_resp.status_code}: ${data.base_resp.status_msg ?? "unknown"}`,
    );
  }
  const hex = data.data?.audio;
  if (!hex) throw new Error("MiniMax preview: no audio in response");

  // MiniMax returns hex-encoded audio bytes. Convert to ArrayBuffer for the
  // browser audio element.
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return { audio: bytes.buffer, format: "audio/mpeg" };
}
