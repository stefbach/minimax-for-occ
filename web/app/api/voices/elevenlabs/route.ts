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
    // 1) Voix du compte (voix personnelles + Pre-Made ajoutees + clonees).
    const rOwn = await fetch(
      "https://api.elevenlabs.io/v1/voices?show_legacy=true",
      {
        method: "GET",
        headers: { "xi-api-key": apiKey, Accept: "application/json" },
        next: { revalidate: 300 },
      },
    );
    if (!rOwn.ok) {
      const errBody = await rOwn.text().catch(() => "");
      return NextResponse.json(
        {
          voices: [],
          error: `ElevenLabs HTTP ${rOwn.status}`,
          detail: errBody.slice(0, 300),
        },
        { status: 502 },
      );
    }
    const ownData = (await rOwn.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        description?: string | null;
        labels?: Record<string, string> | null;
        preview_url?: string | null;
        category?: string | null;
      }>;
    };

    // 2) Voix publiques de la Voice Library (~3000+ voix communautaires).
    //    /v1/shared-voices est pagine — on prend les premieres ~1000 pour
    //    pas exploser le payload. Filtre featured pour qualite.
    type SharedVoice = {
      voice_id: string;
      name: string;
      description?: string | null;
      labels?: Record<string, string> | null;
      gender?: string | null;
      accent?: string | null;
      language?: string | null;
      use_case?: string | null;
      age?: string | null;
      preview_url?: string | null;
      category?: string | null;
    };
    const shared: SharedVoice[] = [];
    try {
      // /v1/shared-voices : pagination par numero de page (1, 2, 3…),
      // 100 voix par page. On boucle jusqu'a has_more=false ou max 30 pages
      // (~3000 voix, taille de la Library actuelle).
      const page_size = 100;
      for (let page = 1; page <= 30; page++) {
        const url = new URL("https://api.elevenlabs.io/v1/shared-voices");
        url.searchParams.set("page_size", String(page_size));
        url.searchParams.set("page", String(page));
        const rs = await fetch(url.toString(), {
          method: "GET",
          headers: { "xi-api-key": apiKey, Accept: "application/json" },
          next: { revalidate: 600 },
        });
        if (!rs.ok) break;
        const sd = (await rs.json()) as {
          voices?: SharedVoice[];
          has_more?: boolean;
        };
        const got = Array.isArray(sd.voices) ? sd.voices : [];
        if (got.length === 0) break;
        shared.push(...got);
        if (sd.has_more === false) break;
        if (got.length < page_size) break; // securite : pas de page suivante
      }
    } catch {
      /* shared est optionnel, on continue avec juste les voix perso */
    }

    // Fusionne les 2 listes, deduplique par voice_id.
    const merged = new Map<string, SharedVoice>();
    for (const v of ownData.voices ?? []) merged.set(v.voice_id, v);
    for (const v of shared) {
      if (!merged.has(v.voice_id)) merged.set(v.voice_id, v);
    }
    const data = { voices: Array.from(merged.values()) };

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
      // Les voix /v1/voices mettent les meta dans labels{}, les voix
      // /v1/shared-voices les mettent au top level. On supporte les 2.
      const gender = (() => {
        const raw = (labels.gender ?? v.gender ?? "").toString().toLowerCase();
        if (raw === "female" || raw === "feminine") return "feminine";
        if (raw === "male" || raw === "masculine") return "masculine";
        if (raw === "neutral" || raw === "neutre") return "neutral";
        return null;
      })();
      const accent = (labels.accent ?? v.accent ?? null) as string | null;
      const language = (labels.language ?? v.language ?? null) as string | null;
      const useCase = (labels.use_case ?? labels.useCase ?? v.use_case ?? null) as
        | string
        | null;
      const age = (labels.age ?? v.age ?? null) as string | null;
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
