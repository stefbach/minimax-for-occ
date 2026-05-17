import { PhaseStub } from "@/components/PhaseStub";

export default function QueuesPage() {
  return (
    <PhaseStub
      title="Files d'attente"
      phase="Phase 1"
      description="Files de routage skill-based : chaque file regroupe N agents (IA et humains). Quand un appel arrive dans une file, l'algorithme (longest-idle, round-robin, broadcast) choisit l'agent libre prioritaire."
      bullets={[
        "Création de file, choix de stratégie, max_wait_secs, fallback voicemail",
        "Drag-drop des agents (IA + humains) avec priorité",
        "Métriques live : appels en attente, temps moyen d'attente, agents disponibles",
      ]}
    />
  );
}
