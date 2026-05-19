import { Softphone } from "@/components/voice/Softphone";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function DeskPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mon poste</h1>
          <div className="subtitle">
            Softphone web — présence, appels routés, contrôles LiveKit.
          </div>
        </div>
        <HelpButton contextKey="desk" />
      </div>
      <Softphone />
    </div>
  );
}
