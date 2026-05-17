import { PhaseStub } from "@/components/PhaseStub";

export default function NumbersPage() {
  return (
    <PhaseStub
      title="Numéros de téléphone"
      phase="Phase 1"
      description="Provisionnement de numéros Twilio depuis l'UI. Chaque numéro est attaché à un Flow (IVR) qui définit comment l'appel entrant est routé."
      bullets={[
        "Recherche + achat de numéros Twilio par pays / indicatif",
        "Attachement à un Flow (welcome → AI / queue / voicemail)",
        "Activation SMS pour callbacks",
        "Gestion des capabilities (voice / sms / mms / fax)",
      ]}
    />
  );
}
