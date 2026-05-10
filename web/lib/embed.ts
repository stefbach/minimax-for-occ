/**
 * Generate embeddings using OpenAI text-embedding-3-small (1536 dimensions).
 * Used by RAG ingest path — server-side only.
 */
export async function embedText(input: string | string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const inputs = Array.isArray(input) ? input : [input];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

/**
 * Naive paragraph-based chunker, ~700 char target with overlap.
 * Sufficient for first version; swap for tiktoken-based chunking later.
 */
export function chunkText(text: string, opts: { target?: number; overlap?: number } = {}): string[] {
  const target = opts.target ?? 700;
  const overlap = opts.overlap ?? 80;
  const cleaned = text.replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return [];

  // First split on blank lines (paragraphs), then merge until each chunk hits target.
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > target && current.length > 0) {
      chunks.push(current);
      // carry overlap (tail of previous chunk) into next chunk to preserve context
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = tail ? tail + "\n\n" + p : p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
