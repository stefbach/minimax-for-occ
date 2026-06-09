import { SuperviseLiveClient } from "@/components/desk/SuperviseLiveClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function SuperviseLivePage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Supervision live</h1>
          <div className="subtitle">
            Qui est en ligne, qui parle avec qui, depuis combien de temps.
            Mise à jour automatique toutes les 5 secondes.
          </div>
        </div>
        <HelpButton contextKey="supervise.live" />
      </div>
      <SuperviseLiveClient />
    </div>
  );
}
