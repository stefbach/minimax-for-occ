import { NextResponse } from "next/server";

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
    const r = await fetch(`${base}/voices`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": "2025-04-16",
      },
    });
    if (r.ok) {
      const raw = await r.json().catch(() => null);
      let voices: unknown[] = [];
      let shape = "array";
      if (Array.isArray(raw)) {
        voices = raw;
      } else if (raw && typeof raw === "object") {
        shape = `object{${Object.keys(raw as object).join(",")}}`;
        for (const key of ["voices", "items", "data", "results"]) {
          if (Array.isArray((raw as Record<string, unknown>)[key])) {
            voices = (raw as Record<string, unknown>)[key] as unknown[];
            break;
          }
        }
      }
      checks.push({
        name: "Cartesia /voices",
        ok: true,
        detail: `OK — ${voices.length} voix disponibles (shape: ${shape})`,
      });
    } else {
      checks.push({
        name: "Cartesia /voices",
        ok: false,
        detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
      });
    }
  } catch (e) {
    checks.push({
      name: "Cartesia /voices",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
