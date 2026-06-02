import { NextResponse } from "next/server";
import { listCartesiaVoices } from "@/lib/cartesia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.CARTESIA_API_KEY;
  const base = (process.env.CARTESIA_BASE_URL ?? "https://api.cartesia.ai").replace(/\/$/, "");
  const VERSION = "2026-03-01";

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({ name: "CARTESIA_API_KEY", ok: !!apiKey, detail: apiKey ? "défini" : "manquant" });
  checks.push({ name: "Cartesia-Version", ok: true, detail: VERSION });

  if (!apiKey) {
    return NextResponse.json({ ok: false, checks });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Cartesia-Version": VERSION,
  };

  // List available TTS models
  try {
    const r = await fetch(`${base}/tts/models`, { headers });
    if (r.ok) {
      const data = await r.json().catch(() => null);
      const models: string[] = Array.isArray(data)
        ? data.map((m: { model_id?: string; id?: string }) => m.model_id ?? m.id ?? "?")
        : [];
      checks.push({ name: "Modèles TTS disponibles", ok: true, detail: models.join(", ") || JSON.stringify(data).slice(0, 200) });
    } else {
      const txt = await r.text().catch(() => "");
      checks.push({ name: "Modèles TTS disponibles", ok: false, detail: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
    }
  } catch (e) {
    checks.push({ name: "Modèles TTS disponibles", ok: false, detail: String(e) });
  }

  // Test sonic-3.5 preview with a short clip
  try {
    const r = await fetch(`${base}/tts/bytes`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "sonic-3.5",
        transcript: "Test",
        voice: { mode: "id", id: "f786b574-daa5-4673-aa0c-cbe3e8534c02" },
        output_format: { container: "mp3", encoding: "mp3", sample_rate: 22050 },
      }),
    });
    if (r.ok) {
      checks.push({ name: "TTS sonic-3.5", ok: true, detail: "OK" });
    } else {
      const txt = await r.text().catch(() => "");
      checks.push({ name: "TTS sonic-3.5", ok: false, detail: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
    }
  } catch (e) {
    checks.push({ name: "TTS sonic-3.5", ok: false, detail: String(e) });
  }

  // Test sonic-3 as fallback
  try {
    const r = await fetch(`${base}/tts/bytes`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "sonic-3",
        transcript: "Test",
        voice: { mode: "id", id: "f786b574-daa5-4673-aa0c-cbe3e8534c02" },
        output_format: { container: "mp3", encoding: "mp3", sample_rate: 22050 },
      }),
    });
    if (r.ok) {
      checks.push({ name: "TTS sonic-3", ok: true, detail: "OK" });
    } else {
      const txt = await r.text().catch(() => "");
      checks.push({ name: "TTS sonic-3", ok: false, detail: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
    }
  } catch (e) {
    checks.push({ name: "TTS sonic-3", ok: false, detail: String(e) });
  }

  // Voice count
  try {
    const all = await listCartesiaVoices();
    const byLang = new Map<string, number>();
    for (const v of all) {
      const lang = v.language ?? "?";
      byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
    }
    const breakdown = Array.from(byLang.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([l, n]) => `${l}:${n}`)
      .join(", ");
    checks.push({ name: "Voix disponibles", ok: true, detail: `${all.length} voix — ${breakdown || "aucune"}` });
  } catch (e) {
    checks.push({ name: "Voix disponibles", ok: false, detail: String(e) });
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
