import { PhaseStub } from "@/components/PhaseStub";

export default function DeskPage() {
  return (
    <PhaseStub
      title="Mon poste — softphone web"
      phase="Phase 3"
      description="Poste de travail de l'agent humain : WebRTC via LiveKit, présence (available/busy/away), réception des appels routés par les queues, click-to-call sortant, transfert AI ↔ humain en un clic."
      bullets={[
        "Présence persistée dans public.human_presence (Supabase Realtime)",
        "Audio LiveKit avec mute / hold / transfer",
        "Volet droit : fiche contact CRM + transcript live + notes de fin d'appel",
        "Bouton transfert vers un autre agent ou vers un agent IA",
      ]}
    />
  );
}
