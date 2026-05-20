import { NextResponse } from "next/server";
import { getPersona } from "@/lib/personas/loader";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CloneBody = {
  name?: string;
  voice_id?: string | null;
  llm_model?: string | null;
};

/**
 * POST /api/personas/[slug]/clone
 *
 * Clones a persona from the library (`/personas/<industry>/<slug>.md`) into
 * the current org as a fresh `agents` row. The persona markdown is parsed
 * into YAML frontmatter + body; the body becomes the agent's system prompt.
 *
 * Request body (all optional):
 *   { name?: string, voice_id?: string|null, llm_model?: string|null }
 *
 * Returns: { id, name, url }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const persona = await getPersona(slug);
  if (!persona) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }

  let body: CloneBody = {};
  try {
    body = (await req.json()) as CloneBody;
  } catch {
    // empty body is fine
  }

  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  const fm = persona.frontmatter;
  const name =
    body.name?.trim() ||
    (typeof fm.title === "string" && fm.title) ||
    persona.title;
  const language = typeof fm.language === "string" ? fm.language : "multi";
  const llmModel =
    body.llm_model ||
    (typeof fm.llm_model === "string" ? fm.llm_model : "gpt-4o-mini");
  const voiceId = body.voice_id ?? null;
  const llmProvider = inferProvider(llmModel);

  const { data, error } = await sb
    .from("agents")
    .insert({
      org_id: orgId,
      name,
      description: persona.description,
      language,
      llm_provider: llmProvider,
      llm_model: llmModel,
      tts_voice_id: voiceId,
      tts_emotion: null,
      tts_speed: 1.0,
      tts_model: null,
      system_prompt: persona.body,
      greeting: defaultGreeting(language),
      rag_enabled: false,
      rag_top_k: 4,
      metadata: {
        persona_source: {
          slug: persona.slug,
          frontmatter: fm,
        },
        persona_industry: persona.industry,
      },
    })
    .select("id, name")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    {
      id: data.id,
      name: data.name,
      url: `/agents/${data.id}`,
    },
    { status: 201 }
  );
}

function inferProvider(model: string): "openai" | "anthropic" | "minimax" {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("minimax")) return "minimax";
  return "openai";
}

function defaultGreeting(lang: string): string {
  if (lang === "en") return "Hello, how may I help you?";
  if (lang === "es") return "Hola, ¿en qué puedo ayudarle?";
  if (lang === "de") return "Guten Tag, wie kann ich Ihnen helfen?";
  if (lang === "it") return "Buongiorno, come posso aiutarla?";
  return "Bonjour, je vous écoute.";
}
