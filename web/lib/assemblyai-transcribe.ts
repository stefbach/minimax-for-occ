// Batch (post-call) transcription via AssemblyAI — same STT vendor already
// used by the LiveKit voice agent (agent/agent.py), reused here as a plain
// REST call so we don't need to route human-to-human "Mon Poste" calls
// through a LiveKit room just to get a transcript.
//
// Flow: download the recording bytes ourselves (Twilio requires Basic Auth,
// AssemblyAI can't fetch it directly), re-upload to AssemblyAI's /v2/upload,
// submit a /v2/transcript job against that upload URL, poll until done.

const ASSEMBLYAI_API = "https://api.assemblyai.com/v2";

export type AssemblyTranscript = {
  text: string;
  utterances: Array<{ speaker: string; text: string; start: number; end: number }> | null;
};

export async function transcribeAudioBuffer(
  audioBuf: Buffer,
  opts?: { language?: string; speakerLabels?: boolean },
): Promise<AssemblyTranscript> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY not configured");

  const headers = { authorization: apiKey };

  // 1. Upload the raw audio bytes, get back a temporary AssemblyAI-hosted URL.
  // fetch's BodyInit doesn't include Node's Buffer type in the DOM lib typings
  // used by this project — a plain Uint8Array view over the same bytes
  // satisfies BodyInit without copying.
  const uploadRes = await fetch(`${ASSEMBLYAI_API}/upload`, {
    method: "POST",
    headers,
    body: new Uint8Array(audioBuf),
  });
  if (!uploadRes.ok) throw new Error(`assemblyai upload failed: ${await uploadRes.text()}`);
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  // 2. Submit the transcription job.
  const submitRes = await fetch(`${ASSEMBLYAI_API}/transcript`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: opts?.language ?? "en",
      speaker_labels: opts?.speakerLabels ?? true,
    }),
  });
  if (!submitRes.ok) throw new Error(`assemblyai submit failed: ${await submitRes.text()}`);
  const { id } = (await submitRes.json()) as { id: string };

  // 3. Poll until completed/error. AssemblyAI batch jobs for a ~5min call
  // typically finish in 15-60s.
  const startedAt = Date.now();
  const timeoutMs = 120_000;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${ASSEMBLYAI_API}/transcript/${id}`, { headers });
    if (!pollRes.ok) throw new Error(`assemblyai poll failed: ${await pollRes.text()}`);
    const job = (await pollRes.json()) as {
      status: string;
      text?: string;
      error?: string;
      utterances?: Array<{ speaker: string; text: string; start: number; end: number }>;
    };
    if (job.status === "completed") {
      return { text: job.text ?? "", utterances: job.utterances ?? null };
    }
    if (job.status === "error") {
      throw new Error(`assemblyai transcription error: ${job.error ?? "unknown"}`);
    }
  }
  throw new Error("assemblyai transcription timed out");
}
