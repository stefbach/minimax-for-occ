import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Smoke-test MiniMax credentials and the TTS endpoint without trying to
 * synthesize real audio. Calls /v1/get_voice (a free metadata endpoint
 * that just lists your account's available voices).
 */
export async function GET() {
  const apiKey = process.env.MINIMAX_API_KEY;
  const base = (process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/$/, "");
  const groupId = process.env.MINIMAX_GROUP_ID;

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({ name: "MINIMAX_API_KEY", ok: !!apiKey, detail: apiKey ? "défini" : "manquant" });
  checks.push({ name: "MINIMAX_BASE_URL", ok: true, detail: base });
  checks.push({
    name: "MINIMAX_GROUP_ID",
    ok: true,
    detail: groupId ? "défini (utilisé pour /t2a_v2)" : "non défini (OK pour la plupart des comptes)",
  });

  if (!apiKey) {
    return NextResponse.json({ ok: false, checks });
  }

  // Test 1 — /get_voice endpoint
  try {
    const url = groupId
      ? `${base}/get_voice?GroupId=${encodeURIComponent(groupId)}`
      : `${base}/get_voice`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ voice_type: "all" }),
    });
    if (r.ok) {
      const j = (await r.json()) as { base_resp?: { status_code?: number; status_msg?: string } };
      const code = j.base_resp?.status_code;
      checks.push({
        name: "MiniMax /get_voice",
        ok: code === 0 || code === undefined,
        detail: code === 0 || code === undefined
          ? "OK"
          : `code ${code}: ${j.base_resp?.status_msg ?? "unknown"}`,
      });
    } else {
      checks.push({
        name: "MiniMax /get_voice",
        ok: false,
        detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
      });
    }
  } catch (e) {
    checks.push({
      name: "MiniMax /get_voice",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
