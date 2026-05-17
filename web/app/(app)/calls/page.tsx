import { PhaseStub } from "@/components/PhaseStub";

export default function CallsPage() {
  return (
    <PhaseStub
      title="Appels — vue live"
      phase="Phase 1"
      description="Liste temps-réel des appels en cours : entrants, sortants, en queue, en wrap-up. Click-to-listen / whisper / barge pour les superviseurs (phase 6)."
      bullets={[
        "Stream Supabase Realtime sur la table public.calls",
        "Filtre par état (queued / ringing / in_progress / wrap_up)",
        "Affichage du transcript live à mesure que Deepgram transcrit",
        "Boutons agent : transférer, mettre en attente, raccrocher",
      ]}
    />
  );
}
