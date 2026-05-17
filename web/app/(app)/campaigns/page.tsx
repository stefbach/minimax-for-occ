import { PhaseStub } from "@/components/PhaseStub";

export default function CampaignsPage() {
  return (
    <PhaseStub
      title="Campagnes outbound"
      phase="Phase 5"
      description="Campagnes d'appels sortants pilotés par un agent IA : import d'une liste de contacts, planning (jours / heures), concurrence maximale, retry, AMD (answering machine detection)."
      bullets={[
        "Création de campagne : agent IA assigné, numéro émetteur, contacts cibles",
        "Worker dialer (Fly.io + BullMQ) qui respecte les fenêtres horaires",
        "Suivi par target : tentatives, dernier statut, prochain essai",
        "Dashboard : taux de réponse, durée moyenne, transferts humains",
      ]}
    />
  );
}
