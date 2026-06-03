import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

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

async function checkCartesia(apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) {
    return { service: "Cartesia TTS", status: "fail", message: "CARTESIA_API_KEY manquante côté serveur" };
  }
  try {
    const r = await fetchWithTimeout("https://api.cartesia.ai/voices", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": "2026-03-01",
      },
    });
    if (r.ok) return { service: "Cartesia TTS", status: "ok", message: "API joignable, clé valide" };
    if (r.status === 401 || r.status === 403) {
      return { service: "Cartesia TTS", status: "fail", message: "Clé API Cartesia invalide" };
    }
    return { service: "Cartesia TTS", status: "fail", message: `HTTP ${r.status}`, detail: await r.text().catch(() => "") };
  } catch (e) {
    return { service: "Cartesia TTS", status: "fail", message: "Service injoignable", detail: String(e) };
  }
}

async function checkAssemblyAI(apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) {
    return { service: "AssemblyAI STT", status: "fail", message: "ASSEMBLYAI_API_KEY manquante (Fly secret uniquement)" };
  }
  try {
    const r = await fetchWithTimeout("https://api.assemblyai.com/v2/account", {
      headers: { Authorization: apiKey },
    });
    if (r.ok) return { service: "AssemblyAI STT", status: "ok", message: "API joignable, clé valide" };
    if (r.status === 401 || r.status === 403) {
      return { service: "AssemblyAI STT", status: "fail", message: "Clé API AssemblyAI invalide" };
    }
    return { service: "AssemblyAI STT", status: "fail", message: `HTTP ${r.status}` };
  } catch (e) {
    return { service: "AssemblyAI STT", status: "fail", message: "Service injoignable", detail: String(e) };
  }
}

async function checkDeepseek(apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) {
    return { service: "DeepSeek", status: "fail", message: "DEEPSEEK_API_KEY manquante côté serveur" };
  }
  try {
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
  try {
    const httpsUrl = url.replace(/^wss?:/, "https:");
    const r = await fetchWithTimeout(httpsUrl, { method: "HEAD" });
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
  if (!agent.tts_voice_id) issues.push("aucune voix Cartesia définie (UUID requis)");
  if (!agent.llm_provider) issues.push("aucun fournisseur LLM");
  if (!agent.llm_model) issues.push("aucun modèle LLM");
  if (issues.length === 0) {
    return { service: "Config agent", status: "ok", message: "Configuration complète" };
  }
  return { service: "Config agent", status: "fail", message: issues.join(", ") };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: agent, error } = await sb
    .from("agents")
    .select("id, name, tts_voice_id, tts_model, llm_provider, llm_model, language")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error || !agent) {
    return NextResponse.json(
      { ok: false, agent_id: id, error: "agent_not_found", checks: [] },
      { status: 404 },
    );
  }

  const [cartesia, assemblyai, deepseek, livekit] = await Promise.all([
    checkCartesia(process.env.CARTESIA_API_KEY),
    checkAssemblyAI(process.env.ASSEMBLYAI_API_KEY),
    checkDeepseek(process.env.DEEPSEEK_API_KEY),
    checkLivekit(),
  ]);
  const config = checkAgentConfig(agent as AgentConfig);

  const checks = [config, livekit, assemblyai, deepseek, cartesia];
  const ok = checks.every((c) => c.status === "ok");
  return NextResponse.json({
    ok,
    agent_id: id,
    agent_name: agent.name,
    checks,
  });
}
