import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/health
 *
 * Runs upstream connectivity + credit checks for every external service
 * the voice agent depends on. Returns a structured diagnostic the UI can
 * render as a banner when a session refuses to connect.
 *
 * Each check has a 5 s timeout so the whole call returns within ~6 s even
 * when something is fully down.
 */

type CheckStatus = "ok" | "fail" | "skipped";
interface CheckResult {
  service: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

const TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkMinimax(apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) {
    return { service: "MiniMax", status: "fail", message: "MINIMAX_API_KEY manquante côté serveur" };
  }
  try {
    // Minimal TTS call — 1 char, surfaces credit/auth errors immediately.
    const r = await fetchWithTimeout("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-02-hd",
        text: ".",
        voice_setting: { voice_id: "Calm_Woman", speed: 1, vol: 1 },
        audio_setting: { sample_rate: 24000, format: "mp3", channel: 1 },
      }),
    });
    const json = (await r.json().catch(() => ({}))) as { base_resp?: { status_code?: number; status_msg?: string } };
    const code = json.base_resp?.status_code;
    const msg = json.base_resp?.status_msg ?? "";
    if (code === 0) return { service: "MiniMax", status: "ok", message: "API joignable, crédit disponible" };
    if (/balance|insufficient|quota/i.test(msg)) {
      return { service: "MiniMax", status: "fail", message: "Crédit MiniMax épuisé", detail: msg };
    }
    if (/auth|token|key/i.test(msg)) {
      return { service: "MiniMax", status: "fail", message: "Clé API MiniMax invalide", detail: msg };
    }
    return { service: "MiniMax", status: "fail", message: msg || `Erreur ${code}`, detail: JSON.stringify(json) };
  } catch (e) {
    return { service: "MiniMax", status: "fail", message: "Service injoignable", detail: String(e) };
  }
}

async function checkDeepseek(apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) {
    return { service: "DeepSeek", status: "fail", message: "DEEPSEEK_API_KEY manquante côté serveur" };
  }
  try {
    // /models is the cheapest auth-checking endpoint.
    const r = await fetchWithTimeout("https://api.deepseek.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) return { service: "DeepSeek", status: "ok", message: "API joignable, clé valide" };
    if (r.status === 401 || r.status === 403) {
      return { service: "DeepSeek", status: "fail", message: "Clé API DeepSeek invalide ou révoquée" };
    }
    if (r.status === 402) {
      return { service: "DeepSeek", status: "fail", message: "Crédit DeepSeek épuisé" };
    }
    return { service: "DeepSeek", status: "fail", message: `HTTP ${r.status}`, detail: await r.text() };
  } catch (e) {
    return { service: "DeepSeek", status: "fail", message: "Service injoignable", detail: String(e) };
  }
}

async function checkDeepgram(apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) {
    return { service: "Deepgram", status: "fail", message: "DEEPGRAM_API_KEY manquante côté serveur" };
  }
  try {
    const r = await fetchWithTimeout("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (r.ok) return { service: "Deepgram", status: "ok", message: "API joignable, clé valide" };
    if (r.status === 401 || r.status === 403) {
      return { service: "Deepgram", status: "fail", message: "Clé API Deepgram invalide" };
    }
    return { service: "Deepgram", status: "fail", message: `HTTP ${r.status}` };
  } catch (e) {
    return { service: "Deepgram", status: "fail", message: "Service injoignable", detail: String(e) };
  }
}

async function checkLivekit(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const sec = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !sec) {
    return {
      service: "LiveKit",
      status: "fail",
      message: "Variables d'environnement LiveKit manquantes",
    };
  }
  // We can't easily hit LiveKit Cloud HTTPS without the server SDK round-trip;
  // a healthy DNS + TLS handshake is a strong signal. Use the project subdomain.
  try {
    const httpsUrl = url.replace(/^wss?:/, "https:");
    const r = await fetchWithTimeout(httpsUrl, { method: "HEAD" });
    // LiveKit Cloud always responds 200/404 to a HEAD on the subdomain.
    if (r.status < 500) return { service: "LiveKit", status: "ok", message: "Endpoint joignable" };
    return { service: "LiveKit", status: "fail", message: `LiveKit Cloud en erreur (HTTP ${r.status})` };
  } catch (e) {
    return { service: "LiveKit", status: "fail", message: "LiveKit Cloud injoignable", detail: String(e) };
  }
}

interface AgentConfig {
  id: string;
  name: string;
  tts_voice_id: string | null;
  tts_model: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  language: string | null;
}

function checkAgentConfig(agent: AgentConfig): CheckResult {
  const issues: string[] = [];
  if (!agent.tts_voice_id) issues.push("aucune voix TTS définie");
  if (agent.tts_voice_id && !agent.tts_model) issues.push("voix définie mais aucun modèle TTS");
  if (!agent.llm_provider) issues.push("aucun fournisseur LLM");
  if (!agent.llm_model) issues.push("aucun modèle LLM");
  if (issues.length === 0) {
    return { service: "Config agent", status: "ok", message: "Configuration complète" };
  }
  return { service: "Config agent", status: "fail", message: issues.join(", ") };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data: agent, error } = await sb
    .from("agents")
    .select("id, name, tts_voice_id, tts_model, llm_provider, llm_model, language")
    .eq("id", id)
    .single();

  if (error || !agent) {
    return NextResponse.json(
      { ok: false, agent_id: id, error: "agent_not_found", checks: [] },
      { status: 404 },
    );
  }

  const [minimax, deepseek, deepgram, livekit] = await Promise.all([
    checkMinimax(process.env.MINIMAX_API_KEY),
    checkDeepseek(process.env.DEEPSEEK_API_KEY),
    checkDeepgram(process.env.DEEPGRAM_API_KEY),
    checkLivekit(),
  ]);
  const config = checkAgentConfig(agent as AgentConfig);

  const checks = [config, livekit, deepgram, deepseek, minimax];
  const ok = checks.every((c) => c.status === "ok");
  return NextResponse.json({
    ok,
    agent_id: id,
    agent_name: agent.name,
    checks,
  });
}
