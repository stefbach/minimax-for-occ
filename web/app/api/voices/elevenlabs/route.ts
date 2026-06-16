import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/elevenlabs
 *
 * Renvoie la liste de toutes les voix accessibles sur le compte ElevenLabs
 * connecte via ELEVEN_API_KEY (voix Pre-Made publiques + voix personnelles
 * + voix clonees + voix sauvegardees). Format normalise pour l'AgentForm :
 *
 *   [{ voice_id, name, description, gender, accent, language, use_case,
 *      preview_url, category }, ...]
 *
 * Le voice_id retourne est l'UUID ElevenLabs (~22 chars alphanumeriques),
 * stocke ensuite dans agents.tts_voice_id avec prefixe "elevenlabs:flash:UUID"
 * ou "elevenlabs:turbo:UUID". Le worker passe l'UUID brut au plugin LiveKit
 * ElevenLabs (cf agent.py:_tts_for).
 */
export async function GET() {
  const apiKey =
    process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    // Pas de cle = pas de catalogue dynamique, on renvoie [] et l'UI affiche
    // un message d'erreur clair. Pas une erreur 500 — l'UI doit pouvoir
    // continuer a fonctionner avec Cartesia + MiniMax sans la cle ElevenLabs.
    return NextResponse.json({ voices: [], note: "ELEVEN_API_KEY missing" });
  }

  try {
    const r = await fetch(
      "https://api.elevenlabs.io/v1/voices?show_legacy=true",
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          Accept: "application/json",
        },
        // Cache cote serveur 5 min : la liste change rarement.
        next: { revalidate: 300 },
      },
    );
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      return NextResponse.json(
        {
          voices: [],
          error: `ElevenLabs HTTP ${r.status}`,
          detail: errBody.slice(0, 300),
        },
        { status: 502 },
      );
    }
    const data = (await r.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        description?: string | null;
        labels?: Record<string, string> | null;
        preview_url?: string | null;
        category?: string | null;
      }>;
    };

    type Voice = {
      voice_id: string;
      name: string;
      description: string | null;
      gender: string | null;
      accent: string | null;
      language: string | null;
      use_case: string | null;
      age: string | null;
      preview_url: string | null;
      category: string | null;
    };
    const voices: Voice[] = (data.voices ?? []).map((v) => {
      const labels = v.labels ?? {};
      // ElevenLabs renvoie un sous-set des champs descriptifs sous labels :
      // gender, accent, language, age, descriptive, use_case…
      // On normalise les noms a notre format interne.
      const gender = (labels.gender ?? null) as string | null;
      const accent = (labels.accent ?? null) as string | null;
      const language = (labels.language ?? null) as string | null;
      const useCase = (labels.use_case ?? labels.useCase ?? null) as
        | string
        | null;
      const age = (labels.age ?? null) as string | null;
      const descriptive = (labels.descriptive ?? null) as string | null;
      // Description finale : on combine description ElevenLabs + descriptifs
      // courts (descriptive, use_case) pour donner un label parlant style
      // "Jessica — Playful, Bright, Warm".
      const parts: string[] = [];
      if (descriptive) parts.push(descriptive);
      if (useCase && (!descriptive || !descriptive.includes(useCase))) {
        parts.push(useCase);
      }
      const description =
        parts.length > 0
          ? parts.join(", ")
          : v.description?.trim() || null;
      return {
        voice_id: v.voice_id,
        name: v.name,
        description,
        gender,
        accent,
        language,
        use_case: useCase,
        age,
        preview_url: v.preview_url ?? null,
        category: v.category ?? null,
      };
    });

    return NextResponse.json({ voices });
  } catch (e) {
    return NextResponse.json(
      {
        voices: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
