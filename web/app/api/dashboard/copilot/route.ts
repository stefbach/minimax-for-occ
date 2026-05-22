import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CallSummary = {
  id: string;
  direction: string;
  state: string;
  started_at: string;
  duration_secs: number | null;
  disposition: string | null;
};

async function buildContextSummary(orgId: string): Promise<string> {
  if (!hasSupabase()) return "Supabase non configuré — pas de données live.";

  const sb = supabaseServer();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const [{ data: todayCalls }, { data: recentCalls }, { count: activeCampaigns }, { count: toRecall }] =
    await Promise.all([
      sb
        .from("calls")
        .select("id, duration_secs, disposition, agent_handle_id, ended_at")
        .eq("org_id", orgId)
        .gte("started_at", todayStart.toISOString()),
      sb
        .from("calls")
        .select("id, direction, state, started_at, duration_secs, disposition")
        .eq("org_id", orgId)
        .order("started_at", { ascending: false })
        .limit(20),
      sb
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("state", "running"),
      sb
        .from("campaign_targets")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("next_attempt_at", now.toISOString()),
    ]);

  const calls = todayCalls ?? [];
  const callsCount = calls.length;
  const ended = calls.filter((r) => r.ended_at && typeof r.duration_secs === "number");
  const avgDuration = ended.length
    ? Math.round(ended.reduce((s, r) => s + (r.duration_secs ?? 0), 0) / ended.length)
    : 0;
  const abandoned = calls.filter((r) => r.disposition === "abandoned").length;
  const abandonRate = callsCount > 0 ? ((abandoned / callsCount) * 100).toFixed(1) : "0.0";

  const recent = (recentCalls ?? []) as CallSummary[];
  const recentLines = recent.map(
    (r) =>
      `- ${new Date(r.started_at).toISOString()} ${r.direction} ${r.state}` +
      ` durée=${r.duration_secs ?? "?"}s disposition=${r.disposition ?? "-"}`,
  );

  return [
    `Date/heure: ${now.toISOString()}`,
    `Appels aujourd'hui: ${callsCount}`,
    `Durée moyenne (terminés): ${avgDuration}s`,
    `Taux d'abandon: ${abandonRate}%`,
    `Campagnes actives: ${activeCampaigns ?? 0}`,
    `Contacts à rappeler (next_attempt_at <= now): ${toRecall ?? 0}`,
    "",
    "20 derniers appels:",
    ...(recentLines.length ? recentLines : ["(aucun appel récent)"]),
  ].join("\n");
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return new Response(
      JSON.stringify({ error: "DEEPSEEK_API_KEY missing" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const { messages } = (await req.json()) as {
    messages: UIMessage[];
    org_id?: string; // accepted for backward compat with old clients but ignored
  };

  // Derive org from session — never trust the body. RLS guards the DB
  // queries inside buildContextSummary().
  const orgId = await requestOrgId(req);
  let summary = "";
  try {
    summary = await buildContextSummary(orgId);
  } catch (e) {
    summary = `Erreur de récupération de l'état: ${e instanceof Error ? e.message : "?"}`;
  }

  const system = [
    "Tu es l'assistant du manager d'un centre d'appels (plateforme Axon).",
    "Tu réponds en français, factuel, court, orienté action.",
    "Si l'utilisateur demande une analyse, base-toi sur les données ci-dessous.",
    "Si l'information manque, dis-le clairement plutôt que d'inventer.",
    "",
    "État courant:",
    summary,
  ].join("\n");

  const deepseek = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1"),
    compatibility: "compatible",
  });

  const result = streamText({
    model: deepseek("deepseek-chat"),
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
