import { NextResponse } from "next/server";
import { getPersona } from "@/lib/personas/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/personas/[slug] — full persona detail (metadata + markdown body).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const persona = await getPersona(slug);
  if (!persona) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }
  return NextResponse.json(persona);
}
