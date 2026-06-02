import { NextResponse } from "next/server";
import { listCartesiaVoices } from "@/lib/cartesia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/cartesia
 * Proxies Cartesia's voice catalog. Returns [] when CARTESIA_API_KEY is unset.
 * The agent form uses this to populate the voice dropdown without exposing the key client-side.
 */
export async function GET() {
  if (!process.env.CARTESIA_API_KEY) {
    return NextResponse.json([]);
  }
  try {
    const voices = await listCartesiaVoices();
    return NextResponse.json(voices);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
