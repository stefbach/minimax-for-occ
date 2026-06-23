import { NextRequest, NextResponse } from "next/server";
import { listReplicateVoices } from "@/lib/replicate";
import { cfg } from "@/lib/config";

/**
 * GET /api/voices/replicate
 * Renvoie le catalogue Replicate (ElevenLabs Flash + Turbo + MiniMax Turbo + HD).
 * Retourne [] (statut 200) si REPLICATE_API_TOKEN n'est pas configuré, pour
 * que le UI dégrade proprement (les Cartesia restent dispos).
 */
export async function GET(_req: NextRequest) {
  if (!cfg.replicate.apiKey) {
    return NextResponse.json([], {
      headers: { "x-replicate-status": "missing-key" },
    });
  }
  try {
    const voices = listReplicateVoices();
    return NextResponse.json(voices);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
