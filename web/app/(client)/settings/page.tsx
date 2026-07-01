import { hasSupabase } from "@/lib/supabase";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

type Section = "Base & auth" | "IA · LLM / TTS / STT" | "LiveKit" | "Telephony · Twilio" | "Telephony · Telnyx" | "App · webhooks" | "n8n";

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
    { name: "SUPABASE_URL", ok: !!process.env.SUPABASE_URL, hint: "Supabase project URL (Settings → API).", level: "required", section: "Base & auth" },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY, hint: "Service role key — Supabase → Settings → API. Server-side only.", level: "required", section: "Base & auth" },
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL, hint: "Supabase URL exposed to the browser. Used by the auth middleware and OrgSwitcher.", level: "required", section: "Base & auth" },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, hint: "Supabase anon key. Without it, the middleware lets requests through without login (dev failsafe).", level: "required", section: "Base & auth" },

    // ─── IA · LLM / TTS / STT ────────────────────────────────────────────
    { name: "DEEPSEEK_API_KEY", ok: !!process.env.DEEPSEEK_API_KEY, hint: "DeepSeek key — text chat, call analysis, copilot, default AI agents. sk-... at https://platform.deepseek.com/api_keys.", level: "required", section: "IA · LLM / TTS / STT" },
    { name: "DEEPSEEK_BASE_URL", ok: !!process.env.DEEPSEEK_BASE_URL, hint: "Optional — overrides the DeepSeek URL (proxy or on-prem deployment). Default: https://api.deepseek.com/v1.", level: "optional", section: "IA · LLM / TTS / STT" },
    { name: "OPENAI_API_KEY", ok: !!process.env.OPENAI_API_KEY, hint: "Required only for RAG embeddings (text-embedding-3-small, 1536 dims). Changing models would require re-indexing all existing vectors.", level: "optional", section: "IA · LLM / TTS / STT" },
    { name: "ANTHROPIC_API_KEY", ok: !!process.env.ANTHROPIC_API_KEY, hint: "Optional — only if an agent uses llm_provider = anthropic.", level: "optional", section: "IA · LLM / TTS / STT" },
    { name: "CARTESIA_API_KEY", ok: !!process.env.CARTESIA_API_KEY, hint: "Cartesia Sonic — TTS (~90ms TTFB). Required for voice, cloning and preview. cartesia.ai → Dashboard → API Keys.", level: "required", section: "IA · LLM / TTS / STT" },
    { name: "ASSEMBLYAI_API_KEY", ok: !!process.env.ASSEMBLYAI_API_KEY, hint: "AssemblyAI Universal Streaming — STT (<300ms). Fly secret only (not exposed client-side). assemblyai.com → Dashboard → API Keys.", level: "required", section: "IA · LLM / TTS / STT" },

    // ─── LiveKit ─────────────────────────────────────────────────────────
    { name: "NEXT_PUBLIC_LIVEKIT_URL", ok: !!process.env.NEXT_PUBLIC_LIVEKIT_URL, hint: "wss://<project>.livekit.cloud — used by the browser (softphone, voice session).", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_API_KEY", ok: !!process.env.LIVEKIT_API_KEY, hint: "LiveKit Cloud → Settings → Keys. Mints JWTs server-side.", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_API_SECRET", ok: !!process.env.LIVEKIT_API_SECRET, hint: "LiveKit Cloud → Settings → Keys.", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_SIP_URI", ok: !!process.env.LIVEKIT_SIP_URI, hint: "REQUIRED for telephony. LiveKit SIP trunk URI, e.g. sip:<project>.sip.livekit.cloud. Without it /api/twilio-voice returns 500 and all calls (inbound and outbound) play 'application error'.", level: "required", section: "LiveKit" },
    { name: "LIVEKIT_SIP_USERNAME", ok: !!process.env.LIVEKIT_SIP_USERNAME, hint: "Optional — only if your SIP trunk requires username/password auth.", level: "optional", section: "LiveKit" },
    { name: "LIVEKIT_SIP_PASSWORD", ok: !!process.env.LIVEKIT_SIP_PASSWORD, hint: "Optional — counterpart to LIVEKIT_SIP_USERNAME.", level: "optional", section: "LiveKit" },
    { name: "LIVEKIT_URL", ok: !!process.env.LIVEKIT_URL, hint: "Optional — server-only variant of NEXT_PUBLIC_LIVEKIT_URL. Used by /api/desk/dial to call LiveKit's outbound SIP API. Falls back to NEXT_PUBLIC_LIVEKIT_URL if absent.", level: "optional", section: "LiveKit" },
    { name: "LIVEKIT_SIP_OUTBOUND_TRUNK_ID", ok: !!process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID, hint: "Enables the LiveKit outbound SIP API path in /api/desk/dial (instead of Twilio REST + TwiML callback) — this lets the human speak to the destination via softphone. ID returned by 'lk sip outbound-trunk create agent/sip/outbound-trunk.json'. Without it, /desk/dial falls back to Twilio REST and the destination lands in a 'tel-*' room (AI answers, not you).", level: "optional", section: "LiveKit" },

    // ─── Telephony · Twilio ──────────────────────────────────────────────
    { name: "TWILIO_ACCOUNT_SID", ok: !!process.env.TWILIO_ACCOUNT_SID, hint: "Twilio Console → Account → API keys & tokens (starts with AC...). Required for /numbers and /desk/dial.", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_AUTH_TOKEN", ok: !!process.env.TWILIO_AUTH_TOKEN, hint: "Twilio Auth Token — used for the REST API AND to validate signed webhooks (X-Twilio-Signature).", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_API_KEY_SID", ok: !!process.env.TWILIO_API_KEY_SID, hint: "Twilio API Key SID (starts with SK...). Used to mint Twilio Voice SDK tokens for the browser softphone. Create in Twilio Console → Account → API keys & tokens.", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_API_KEY_SECRET", ok: !!process.env.TWILIO_API_KEY_SECRET, hint: "Secret accompanying TWILIO_API_KEY_SID. Shown ONCE at creation time — copy it then.", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_TWIML_APP_SID", ok: !!process.env.TWILIO_TWIML_APP_SID, hint: "TwiML App SID (starts with AP...). Create in Twilio Console → Voice → Manage → TwiML apps, Voice URL = https://<your-app>/api/twilio/voice-outbound. Tells Twilio where to fetch TwiML when the browser dials a number.", level: "required", section: "Telephony · Twilio" },
    { name: "TWILIO_SKIP_VALIDATION", ok: !!process.env.TWILIO_SKIP_VALIDATION, hint: "⚠️ Bypasses Twilio signature validation. Do NOT set in production — local testing only.", level: "info", section: "Telephony · Twilio" },

    // ─── Telephony · Telnyx ─────────────────────────────────────────────
    { name: "TELNYX_API_KEY", ok: !!process.env.TELNYX_API_KEY, hint: "Telnyx Mission Control → Auth → API Keys → Create v2 (starts with KEY_...). Required for number management and routing.", level: "required", section: "Telephony · Telnyx" },
    { name: "TELNYX_SIP_CONNECTION_ID", ok: !!process.env.TELNYX_SIP_CONNECTION_ID, hint: "Telnyx → Voice Suite → SIP Trunking → your trunk → Connection ID. Used to assign purchased numbers to the LiveKit trunk.", level: "required", section: "Telephony · Telnyx" },
    { name: "TELNYX_OUTBOUND_PROFILE_ID", ok: !!process.env.TELNYX_OUTBOUND_PROFILE_ID, hint: "Telnyx → Voice Suite → Outbound Voice → your profile → ID. Required for outbound calls via Telnyx.", level: "optional", section: "Telephony · Telnyx" },
    { name: "TELNYX_WEBHOOK_SECRET", ok: !!process.env.TELNYX_WEBHOOK_SECRET, hint: "Telnyx → Webhooks → your endpoint → Signing Secret (whsec_...). Validates Ed25519 signatures on /api/telnyx-voice and /api/telnyx/status.", level: "optional", section: "Telephony · Telnyx" },
    { name: "TELNYX_SKIP_VALIDATION", ok: !!process.env.TELNYX_SKIP_VALIDATION, hint: "⚠️ Bypasses Telnyx signature validation. Dev only.", level: "info", section: "Telephony · Telnyx" },

    // ─── App · webhooks ──────────────────────────────────────────────────
    { name: "APP_URL", ok: !!process.env.APP_URL, hint: "Public URL of this app (e.g. https://minimax-for-occ.vercel.app). Used by /api/desk/dial to build the TwiML URL and Twilio StatusCallback. Falls back to NEXT_PUBLIC_APP_URL then VERCEL_URL if absent.", level: "required", section: "App · webhooks" },
    { name: "NEXT_PUBLIC_APP_URL", ok: !!process.env.NEXT_PUBLIC_APP_URL, hint: "Browser-exposed alternative to APP_URL. At least one of the two must point to production.", level: "optional", section: "App · webhooks" },
    { name: "VERCEL_URL", ok: !!process.env.VERCEL_URL, hint: "Auto-injected by Vercel (host of this deployment). Used as fallback when APP_URL and NEXT_PUBLIC_APP_URL are absent — note that on previews this points to the preview, not production.", level: "info", section: "App · webhooks" },
    { name: "APP_SHARED_TOKEN", ok: !!process.env.APP_SHARED_TOKEN, hint: "Optional — bearer token for /api/token when the caller is not a browser (integrations).", level: "optional", section: "App · webhooks" },

    // ─── n8n ─────────────────────────────────────────────────────────────
    { name: "N8N_BASE_URL", ok: !!process.env.N8N_BASE_URL, hint: "E.g. https://n8n.srv808674.hstgr.cloud — n8n instance where agent-triggerable workflows live.", level: "required", section: "n8n" },
    { name: "N8N_API_KEY", ok: !!process.env.N8N_API_KEY, hint: "n8n → Settings → API. Required to discover and trigger workflows.", level: "required", section: "n8n" },
    { name: "N8N_WEBHOOK_BASE_URL", ok: !!process.env.N8N_WEBHOOK_BASE_URL, hint: "Optional — only if your n8n webhooks are hosted on a different domain than the API base URL.", level: "optional", section: "n8n" },
  ];

  const sections: Section[] = [
    "Base & auth",
    "IA · LLM / TTS / STT",
    "LiveKit",
    "Telephony · Twilio",
    "Telephony · Telnyx",
    "App · webhooks",
    "n8n",
  ];
  const grouped: Record<Section, Check[]> = {
    "Base & auth": [],
    "IA · LLM / TTS / STT": [],
    "LiveKit": [],
    "Telephony · Twilio": [],
    "Telephony · Telnyx": [],
    "App · webhooks": [],
    "n8n": [],
  };
  for (const c of checks) grouped[c.section].push(c);

  const missingRequired = checks.filter((c) => c.level === "required" && !c.ok);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">
            Environment variables detected on this Vercel instance.
            To change them: <span className="kbd">Vercel → Settings → Environment Variables</span>,
            then <strong>Redeploy</strong> (env vars are snapshotted at serverless function build time).
          </div>
        </div>
        <HelpButton contextKey="settings" />
      </div>

      {missingRequired.length > 0 ? (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <strong style={{ color: "var(--bad)" }}>
            {missingRequired.length} required variable{missingRequired.length === 1 ? "" : "s"} missing
          </strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {missingRequired.map((c) => c.name).join(", ")}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <span className="tag good">All required variables are set</span>
        </div>
      )}

      {sections.map((s) => (
        <div key={s} className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{s}</div>
          <table className="list">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Level</th>
                <th>Status</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {grouped[s].map((c) => (
                <tr key={c.name}>
                  <td><span className="kbd">{c.name}</span></td>
                  <td>
                    {c.level === "required" ? (
                      <span className="tag">required</span>
                    ) : c.level === "optional" ? (
                      <span className="tag muted">optional</span>
                    ) : (
                      <span className="tag muted">info</span>
                    )}
                  </td>
                  <td>
                    {c.ok ? (
                      <span className="tag good">set</span>
                    ) : c.level === "required" ? (
                      <span className="tag" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>missing</span>
                    ) : (
                      <span className="tag muted">not set</span>
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
        <h3 style={{ marginTop: 0 }}>Initialize Supabase</h3>
        {hasSupabase() ? (
          <p className="muted">
            Supabase is configured. If you see "relation does not exist" errors, apply the migration{" "}
            <span className="kbd">supabase/migrations/0001_axon_init.sql</span> in Supabase → SQL Editor.
          </p>
        ) : (
          <p className="muted">
            First set <span className="kbd">SUPABASE_URL</span> and{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>, then apply the migration.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>LiveKit Cloud Agents — Worker secrets</h3>
        <p className="muted">
          These variables must also be present in the LiveKit worker Secrets (Cloud → Agents → your agent) so the worker can load its config and call services:
          <span className="kbd" style={{ marginLeft: 6 }}>SUPABASE_URL</span>,{" "}
          <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>,{" "}
          <span className="kbd">DEEPSEEK_API_KEY</span>,{" "}
          <span className="kbd">DEEPGRAM_API_KEY</span>,{" "}
          <span className="kbd">MINIMAX_API_KEY</span>,{" "}
          <span className="kbd">N8N_BASE_URL</span>,{" "}
          <span className="kbd">N8N_API_KEY</span>.
        </p>
      </div>
    </>
  );
}
