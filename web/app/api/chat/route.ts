import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { minimax } from "vercel-minimax-ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `Tu es un assistant utile, multilingue (FR/EN).
Réponds dans la langue de l'utilisateur. Sois concis et précis.`;

export async function POST(req: Request) {
  if (!process.env.MINIMAX_API_KEY) {
    return new Response(
      JSON.stringify({ error: "MINIMAX_API_KEY missing" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const { messages } = (await req.json()) as { messages: UIMessage[] };

  const result = streamText({
    model: minimax("MiniMax-M2"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
