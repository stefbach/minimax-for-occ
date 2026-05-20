import { NextResponse } from "next/server";
import { listPersonas } from "@/lib/personas/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/personas
 *
 * Query params (all optional):
 *   industry=hospitality     filter by industry
 *   language=fr              filter by language
 *   tag=concierge            filter by tag (single tag, exact match)
 *   q=hotel                  fulltext search over title/description/slug
 *
 * Returns an array of PersonaSummary.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const industry = url.searchParams.get("industry");
  const language = url.searchParams.get("language");
  const tag = url.searchParams.get("tag");
  const q = url.searchParams.get("q")?.toLowerCase().trim();

  let personas = await listPersonas();

  if (industry) personas = personas.filter((p) => p.industry === industry);
  if (language) personas = personas.filter((p) => p.language === language);
  if (tag) personas = personas.filter((p) => p.tags.includes(tag));
  if (q) {
    personas = personas.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return NextResponse.json(personas);
}
