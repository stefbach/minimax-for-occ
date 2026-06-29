import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import type { Voice } from "@/lib/types";
import { VoiceStudio } from "@/components/voice/VoiceStudio";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

async function loadVoices(): Promise<Voice[]> {
  if (!hasSupabase()) return [];
  const orgId = await currentOrgIdForServer();
  const sb = supabaseServer();
  const { data } = await sb
    .from("voices")
    .select("*")
    .eq("org_id", orgId)
    .order("source", { ascending: true })
    .order("created_at", { ascending: false });
  return (data as Voice[]) ?? [];
}

export default async function VoicesPage() {
  const voices = await loadVoices();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Voice Studio</h1>
          <div className="subtitle">Clone, preview and manage your MiniMax voices.</div>
        </div>
        <HelpButton contextKey="voices" />
      </div>
      {!hasSupabase() ? (
        <div className="card">
          <h3>Supabase not configured</h3>
          <p className="muted">
            Set <span className="kbd">SUPABASE_URL</span> and{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>, then apply the migration{" "}
            <span className="kbd">supabase/migrations/0002_voices.sql</span>.
          </p>
        </div>
      ) : (
        <VoiceStudio initial={voices} />
      )}
    </>
  );
}
