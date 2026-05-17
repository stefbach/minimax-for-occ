import { PhaseStub } from "@/components/PhaseStub";

export default function FlowsPage() {
  return (
    <PhaseStub
      title="Flows / IVR"
      phase="Phase 2"
      description="Constructeur de flows d'appels visuels (drag-drop avec React Flow). Chaque flow est une suite d'étapes (welcome AI, menu DTMF, gather speech, route queue, transfer human, voicemail) reliées par des transitions conditionnelles."
      bullets={[
        "Steps : welcome (TTS) · menu_dtmf · gather_speech · ai_agent · route_queue · transfer · voicemail · hangup",
        "Edges : condition (DTMF key, intent extrait, fallback)",
        "Compilé au runtime côté worker — pas de redéploiement",
        "Test du flow depuis l'UI avec un appel virtuel (sans Twilio)",
      ]}
    />
  );
}
