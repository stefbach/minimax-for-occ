import { NextResponse } from "next/server";
import { listCartesiaVoices } from "@/lib/cartesia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Smoke-test Cartesia credentials and list available voices.
 * Safe to call — GET /voices is a free metadata endpoint.
 */
export async function GET() {
  const apiKey = process.env.CARTESIA_API_KEY;
  const base = (process.env.CARTESIA_BASE_URL ?? "https://api.cartesia.ai").replace(/\/$/, "");

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({ name: "CARTESIA_API_KEY", ok: !!apiKey, detail: apiKey ? "défini" : "manquant" });
  checks.push({ name: "CARTESIA_BASE_URL", ok: true, detail: base });

  if (!apiKey) {
    return NextResponse.json({ ok: false, checks });
  }

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
    checks.push({
      name: "Cartesia /voices (paginé)",
      ok: true,
      detail: `${all.length} voix uniques — ${breakdown || "aucune"}`,
    });
  } catch (e) {
    checks.push({
      name: "Cartesia /voices (paginé)",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
