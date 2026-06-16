import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/minimax
 *
 * Returns the MiniMax voice catalogue normalisé pour l'AgentForm. MiniMax
 * a un catalogue de voix "system" (préréglées, ~20) + les voix clonées sur
 * le compte connecté. La liste system est figée côté MiniMax (pas d'API
 * publique pour les lister), on hardcode donc le set documenté ; les
 * voix clonées sont récupérées via /v1/get_voice si MINIMAX_API_KEY +
 * MINIMAX_GROUP_ID sont configurées.
 *
 * Voice id format renvoyé : "minimax:<model>:<voice_id>". On émet deux
 * entrées par voix (Turbo + HD) pour que l'utilisateur choisisse le
 * modèle directement depuis le dropdown.
 */

type MinimaxVoice = {
  voice_id: string; // ex "minimax:speech-02-turbo:Wise_Woman"
  name: string;
  description: string | null;
  gender: string | null;
  language: string | null;
  category: string; // "system" | "cloned"
  family: string; // "minimax-turbo" | "minimax-hd"
};

// Catalogue système documenté MiniMax (Speech 02). À ajuster si MiniMax
// publie/déprécie des voix. La description vient du portail produit.
const SYSTEM_VOICES: Array<{
  id: string;
  label: string;
  gender: string;
  desc: string;
  lang?: string;
}> = [
  { id: "Wise_Woman", label: "Wise Woman", gender: "feminine", desc: "Mature, posée, autoritaire" },
  { id: "Friendly_Person", label: "Friendly Person", gender: "neutral", desc: "Accueillant, conversationnel" },
  { id: "Inspirational_girl", label: "Inspirational Girl", gender: "feminine", desc: "Énergique, motivante" },
  { id: "Deep_Voice_Man", label: "Deep Voice Man", gender: "masculine", desc: "Grave, sérieux" },
  { id: "Calm_Woman", label: "Calm Woman", gender: "feminine", desc: "Douce, rassurante" },
  { id: "Casual_Guy", label: "Casual Guy", gender: "masculine", desc: "Décontracté, jeune adulte" },
  { id: "Lively_Girl", label: "Lively Girl", gender: "feminine", desc: "Vive, expressive" },
  { id: "Patient_Man", label: "Patient Man", gender: "masculine", desc: "Patient, didactique" },
  { id: "Young_Knight", label: "Young Knight", gender: "masculine", desc: "Jeune, héroïque" },
  { id: "Determined_Man", label: "Determined Man", gender: "masculine", desc: "Déterminé, posé" },
  { id: "Lovely_Girl", label: "Lovely Girl", gender: "feminine", desc: "Mignonne, jeune" },
  { id: "Decent_Boy", label: "Decent Boy", gender: "masculine", desc: "Adolescent posé" },
  { id: "Imposing_Manner", label: "Imposing Manner", gender: "masculine", desc: "Imposant, formel" },
  { id: "Elegant_Man", label: "Elegant Man", gender: "masculine", desc: "Élégant, raffiné" },
  { id: "Abbess", label: "Abbess", gender: "feminine", desc: "Mature, calme et sage" },
  { id: "Sweet_Girl_2", label: "Sweet Girl", gender: "feminine", desc: "Douce, mignonne" },
  { id: "Exuberant_Girl", label: "Exuberant Girl", gender: "feminine", desc: "Exubérante, enthousiaste" },
];

type ClonedVoiceRow = {
  voice_id?: string;
  voice_name?: string | null;
  description?: string | null;
  created_time?: string | null;
};

async function fetchClonedVoices(): Promise<ClonedVoiceRow[]> {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!apiKey || !groupId) return [];
  const base = (process.env.MINIMAX_BASE_URL || "https://api.minimax.io").replace(/\/+$/, "");
  // /v1/get_voice retourne toutes les voix custom (clonées) du compte.
  // voice_type=voice_cloning vise uniquement les clones, pas les system.
  try {
    const r = await fetch(`${base}/v1/get_voice?GroupId=${encodeURIComponent(groupId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_type: "voice_cloning" }),
      // Cache the catalog briefly to avoid hammering MiniMax on every form open.
      next: { revalidate: 300 },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { voice_cloning?: ClonedVoiceRow[] };
    return data.voice_cloning ?? [];
  } catch {
    return [];
  }
}

export async function GET() {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!apiKey || !groupId) {
    return NextResponse.json({
      voices: [],
      note: "MINIMAX_API_KEY/MINIMAX_GROUP_ID missing — direct catalog disabled",
    });
  }

  const cloned = await fetchClonedVoices();
  const voices: MinimaxVoice[] = [];
  const families: Array<{ slug: string; family: string; label: string }> = [
    { slug: "speech-02-turbo", family: "minimax-turbo", label: "Turbo" },
    { slug: "speech-02-hd", family: "minimax-hd", label: "HD" },
  ];

  for (const v of SYSTEM_VOICES) {
    for (const f of families) {
      voices.push({
        voice_id: `minimax:${f.slug}:${v.id}`,
        name: `${v.label} (${f.label})`,
        description: v.desc,
        gender: v.gender,
        language: v.lang ?? null,
        category: "system",
        family: f.family,
      });
    }
  }
  for (const cv of cloned) {
    const vid = cv.voice_id;
    if (!vid) continue;
    const label = cv.voice_name || vid;
    const desc = cv.description || "Voix clonée";
    for (const f of families) {
      voices.push({
        voice_id: `minimax:${f.slug}:${vid}`,
        name: `${label} (${f.label}) — clonée`,
        description: desc,
        gender: null,
        language: null,
        category: "cloned",
        family: f.family,
      });
    }
  }

  return NextResponse.json({ voices });
}
