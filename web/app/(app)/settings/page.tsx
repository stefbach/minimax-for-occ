import { hasSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Check {
  name: string;
  ok: boolean;
  hint: string;
}

export default function SettingsPage() {
  const checks: Check[] = [
    {
      name: "SUPABASE_URL",
      ok: !!process.env.SUPABASE_URL,
      hint: "URL du projet Supabase (Settings → API).",
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hint: "Service role key — Supabase → Settings → API. Server-side uniquement.",
    },
    {
      name: "OPENAI_API_KEY",
      ok: !!process.env.OPENAI_API_KEY,
      hint: "Clé OpenAI — chat texte et embeddings.",
    },
    {
      name: "NEXT_PUBLIC_LIVEKIT_URL",
      ok: !!process.env.NEXT_PUBLIC_LIVEKIT_URL,
      hint: "wss://<projet>.livekit.cloud",
    },
    {
      name: "LIVEKIT_API_KEY",
      ok: !!process.env.LIVEKIT_API_KEY,
      hint: "LiveKit Cloud → Settings → Keys.",
    },
    {
      name: "LIVEKIT_API_SECRET",
      ok: !!process.env.LIVEKIT_API_SECRET,
      hint: "LiveKit Cloud → Settings → Keys.",
    },
    {
      name: "MINIMAX_API_KEY",
      ok: !!process.env.MINIMAX_API_KEY,
      hint: "MiniMax API — utilisée pour le TTS et le clonage de voix.",
    },
    {
      name: "DEEPGRAM_API_KEY",
      ok: !!process.env.DEEPGRAM_API_KEY,
      hint: "Deepgram — STT multilingue côté worker. Doit aussi être en LiveKit Secrets.",
    },
    {
      name: "N8N_BASE_URL",
      ok: !!process.env.N8N_BASE_URL,
      hint: "Ex: https://n8n.srv808674.hstgr.cloud",
    },
    {
      name: "N8N_API_KEY",
      ok: !!process.env.N8N_API_KEY,
      hint: "n8n → Settings → API.",
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Paramètres</h1>
          <div className="subtitle">Variables d&apos;environnement détectées sur cette instance Vercel.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list">
          <thead><tr><th>Variable</th><th>Statut</th><th>Description</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td><span className="kbd">{c.name}</span></td>
                <td>
                  {c.ok ? <span className="tag good">défini</span> : <span className="tag" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>manquant</span>}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{c.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Initialiser Supabase</h3>
        {hasSupabase() ? (
          <p className="muted">
            Supabase est configuré. Si vous voyez des erreurs « relation does not exist », appliquez la migration{" "}
            <span className="kbd">supabase/migrations/0001_axon_init.sql</span> dans Supabase → SQL Editor.
          </p>
        ) : (
          <p className="muted">
            Définissez d&apos;abord <span className="kbd">SUPABASE_URL</span> et{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>, puis appliquez la migration.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>LiveKit Cloud Agents — Secrets côté worker</h3>
        <p className="muted">
          Ces variables doivent aussi être présentes dans les Secrets du worker LiveKit (Cloud → Agents → votre agent) pour que le worker puisse charger la config et appeler les services :
          <span className="kbd" style={{ marginLeft: 6 }}>SUPABASE_URL</span>,{" "}
          <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>,{" "}
          <span className="kbd">OPENAI_API_KEY</span>,{" "}
          <span className="kbd">DEEPGRAM_API_KEY</span>,{" "}
          <span className="kbd">MINIMAX_API_KEY</span>,{" "}
          <span className="kbd">N8N_BASE_URL</span>,{" "}
          <span className="kbd">N8N_API_KEY</span>.
        </p>
      </div>
    </>
  );
}
