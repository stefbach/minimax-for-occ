import { DeskWorkstation } from "@/components/desk/DeskWorkstation";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function DeskPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mon poste</h1>
          <div className="subtitle">
            Ma file de rappels, contexte patient, softphone et pool partagé d&apos;équipe.
          </div>
        </div>
        <HelpButton contextKey="desk" />
      </div>
      <DeskWorkstation />
    </div>
  );
}
