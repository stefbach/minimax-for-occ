import { hasSupabase, supabaseServer } from "@/lib/supabase";
import type { Voice } from "@/lib/types";
import { VoiceStudio } from "@/components/voice/VoiceStudio";

export const dynamic = "force-dynamic";

async function loadVoices(): Promise<Voice[]> {
  if (!hasSupabase()) return [];
  const sb = supabaseServer();
  const { data } = await sb
    .from("voices")
    .select("*")
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
          <div className="subtitle">Cloner, écouter et gérer vos voix MiniMax.</div>
        </div>
      </div>
      {!hasSupabase() ? (
        <div className="card">
          <h3>Supabase non configuré</h3>
          <p className="muted">
            Définissez <span className="kbd">SUPABASE_URL</span> et{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>, puis appliquez la migration{" "}
            <span className="kbd">supabase/migrations/0002_voices.sql</span>.
          </p>
        </div>
      ) : (
        <VoiceStudio initial={voices} />
      )}
    </>
  );
}
