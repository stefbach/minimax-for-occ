import { hasSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Section = "Base & auth" | "IA · LLM / TTS / STT" | "LiveKit" | "Telephony · Twilio" | "App · webhooks" | "n8n";

interface Check {
  name: string;
  ok: boolean;
  hint: string;
  /** "required" = bloque la fonctionnalité ciblée si manquant. "optional" = peut être absent.
   *  "info" = champ purement informatif (auto-injecté, ou opt-in). */
  level: "required" | "optional" | "info";
  section: Section;
}

export default function SettingsPage() {
  const checks: Check[] = [
    // ─── Base & auth ─────────────────────────────────────────────────────
    { name: "SUPABASE_URL", ok: !!process.env.SUPABASE_URL, hint: "URL du projet Supabase (Settings → API).", level: "required", section: "Base & auth" },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY, hint: "Service role key — Supabase → Settings → API. Server-side uniquement.", level: "required", section: "Base & auth" },
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL, hint: "URL Supabase exposée au navigateur. Utilisée par le middleware d'auth et OrgSwitcher.", level: "required", section: "Base & auth" },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, hint: "Clé anon Supabase. Sans elle, le middleware laisse passer sans login (failsafe dev).", level: "required", section: "Base & auth" },

    // ─── IA · LLM / TTS / STT ────────────────────────────────────────────
    { name: "OPENAI_API_KEY", ok: !!process.env.OPENAI_API_KEY, hint: "Clé OpenAI — chat texte, embeddings (RAG), agents IA par défaut.", level: "required", section: "IA · LLM / TTS / STT" },
    { name: "ANTHROPIC_API_KEY", ok: !!process.env.ANTHROPIC_API_KEY, hint: "Optionnel — uniquement si un agent utilise llm_provider = anthropic.", level: "optional", section: "IA · LLM / TTS / STT" },
    { name: "MINIMAX_API_KEY", ok: !!process.env.MINIMAX_API_KEY, hint: "MiniMax — TTS et clonage de voix.", level: "required", section: "IA · LLM / TTS / STT" },
    { name: "MINIMAX_BASE_URL", ok: !!process.env.MINIMAX_BASE_URL, hint: "Optionnel — bascule sur https://api.minimaxi.com/v1 pour les comptes Chine. Par défaut: api.minimax.io.", level: "optional", section: "IA · LLM / TTS / STT" },
    { name: "MINIMAX_GROUP_ID", ok: !!process.env.MINIMAX_GROUP_ID, hint: "Optionnel — requis par /t2a_v2 sur certains types de comptes MiniMax (erreur 'group_id required').", level: "optional", section: "IA · LLM / TTS / STT" },
    { name: "DEEPGRAM_API_KEY", ok: !!process.env.DEEPGRAM_API_KEY, hint: "Deepgram — STT multilingue côté worker. Doit aussi être en LiveKit Secrets.", level: "required", section: "IA · LLM / TTS / STT" },

    // ─── LiveKit ─────────────────────────────────────────────────────────
    { name: "NEXT_PUBLIC_LIVEKIT_URL", ok: !!process.env.NEXT_PUBLIC_LIVEKIT_URL, hint: "wss://<projet>.livekit.cloud — utilisé par le navigateur (softphone, session vocale).", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_API_KEY", ok: !!process.env.LIVEKIT_API_KEY, hint: "LiveKit Cloud → Settings → Keys. Mint les JWT côté serveur.", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_API_SECRET", ok: !!process.env.LIVEKIT_API_SECRET, hint: "LiveKit Cloud → Settings → Keys.", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_SIP_URI", ok: !!process.env.LIVEKIT_SIP_URI, hint: "REQUIS pour la téléphonie. URI du trunk SIP LiveKit, ex: sip:<projet>.sip.livekit.cloud. Sans ça /api/twilio-voice renvoie 500 et tout appel (entrant comme sortant) joue 'application error'.", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_SIP_USERNAME", ok: !!process.env.LIVEKIT_SIP_USERNAME, hint: "Optionnel — uniquement si ton trunk SIP exige une auth username/password.", level: "optional", section: "LiveKit" },
    { name: "LIVEKIT_SIP_PASSWORD", ok: !!process.env.LIVEKIT_SIP_PASSWORD, hint: "Optionnel — pendant de LIVEKIT_SIP_USERNAME.", level: "optional", section: "LiveKit" },

    // ─── Telephony · Twilio ──────────────────────────────────────────────
    { name: "TWILIO_ACCOUNT_SID", ok: !!process.env.TWILIO_ACCOUNT_SID, hint: "Twilio Console → Account → API keys & tokens (commence par AC...). Requis pour /numbers et /desk/dial.", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_AUTH_TOKEN", ok: !!process.env.TWILIO_AUTH_TOKEN, hint: "Auth Token Twilio — utilisé pour l'API REST ET pour valider les webhooks signés (X-Twilio-Signature).", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_SKIP_VALIDATION", ok: !!process.env.TWILIO_SKIP_VALIDATION, hint: "⚠️ Bypass de la validation de signature Twilio. À NE PAS définir en production — uniquement pour les tests locaux.", level: "info", section: "Telephony · Twilio" },

    // ─── App · webhooks ──────────────────────────────────────────────────
    { name: "APP_URL", ok: !!process.env.APP_URL, hint: "URL publique de cette app (ex: https://minimax-for-occ.vercel.app). Utilisée par /api/desk/dial pour construire la TwiML URL et StatusCallback Twilio. Si absente, fallback sur NEXT_PUBLIC_APP_URL puis VERCEL_URL.", level: "required", section: "App · webhooks" },
    { name: "NEXT_PUBLIC_APP_URL", ok: !!process.env.NEXT_PUBLIC_APP_URL, hint: "Alternative à APP_URL exposée au navigateur. Au moins l'une des deux doit pointer vers la prod.", level: "optional", section: "App · webhooks" },
    { name: "VERCEL_URL", ok: !!process.env.VERCEL_URL, hint: "Auto-injecté par Vercel (host de ce déploiement). Sert de fallback si APP_URL et NEXT_PUBLIC_APP_URL sont absents — attention, sur les previews ça pointe sur la preview, pas la prod.", level: "info", section: "App · webhooks" },
    { name: "APP_SHARED_TOKEN", ok: !!process.env.APP_SHARED_TOKEN, hint: "Optionnel — bearer pour /api/token quand l'appelant n'est pas un navigateur (intégrations).", level: "optional", section: "App · webhooks" },

    // ─── n8n ─────────────────────────────────────────────────────────────
    { name: "N8N_BASE_URL", ok: !!process.env.N8N_BASE_URL, hint: "Ex: https://n8n.srv808674.hstgr.cloud — instance n8n où vivent les workflows déclenchables par les agents.", level: "required", section: "n8n" },
    { name: "N8N_API_KEY", ok: !!process.env.N8N_API_KEY, hint: "n8n → Settings → API. Requis pour découvrir et déclencher les workflows.", level: "required", section: "n8n" },
    { name: "N8N_WEBHOOK_BASE_URL", ok: !!process.env.N8N_WEBHOOK_BASE_URL, hint: "Optionnel — uniquement si tes webhooks n8n sont hébergés sur un domaine distinct du base_url API.", level: "optional", section: "n8n" },
  ];

  // Group by section for the rendered table.
  const sections: Section[] = [
    "Base & auth",
    "IA · LLM / TTS / STT",
    "LiveKit",
    "Telephony · Twilio",
    "App · webhooks",
    "n8n",
  ];
  const grouped: Record<Section, Check[]> = {
    "Base & auth": [],
    "IA · LLM / TTS / STT": [],
    "LiveKit": [],
    "Telephony · Twilio": [],
    "App · webhooks": [],
    "n8n": [],
  };
  for (const c of checks) grouped[c.section].push(c);

  // Summary: count required-missing for the header banner.
  const missingRequired = checks.filter((c) => c.level === "required" && !c.ok);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Paramètres</h1>
          <div className="subtitle">
            Variables d&apos;environnement détectées sur cette instance Vercel.
            Pour les modifier : <span className="kbd">Vercel → Settings → Environment Variables</span>,
            puis <strong>Redeploy</strong> (les env sont snapshotées au build des serverless functions).
          </div>
        </div>
      </div>

      {missingRequired.length > 0 ? (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <strong style={{ color: "var(--bad)" }}>
            {missingRequired.length} variable{missingRequired.length === 1 ? "" : "s"} requise{missingRequired.length === 1 ? "" : "s"} manquante{missingRequired.length === 1 ? "" : "s"}
          </strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {missingRequired.map((c) => c.name).join(", ")}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <span className="tag good">Toutes les variables requises sont définies</span>
        </div>
      )}

      {sections.map((s) => (
        <div key={s} className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{s}</div>
          <table className="list">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Niveau</th>
                <th>Statut</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {grouped[s].map((c) => (
                <tr key={c.name}>
                  <td><span className="kbd">{c.name}</span></td>
                  <td>
                    {c.level === "required" ? (
                      <span className="tag">requis</span>
                    ) : c.level === "optional" ? (
                      <span className="tag muted">optionnel</span>
                    ) : (
                      <span className="tag muted">info</span>
                    )}
                  </td>
                  <td>
                    {c.ok ? (
                      <span className="tag good">défini</span>
                    ) : c.level === "required" ? (
                      <span className="tag" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>manquant</span>
                    ) : (
                      <span className="tag muted">non défini</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{c.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

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
