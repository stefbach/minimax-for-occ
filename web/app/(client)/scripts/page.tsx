import { ScriptsClient } from "@/components/scripts/ScriptsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function ScriptsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Scripts</h1>
          <div className="subtitle">
            Playbooks d&apos;appel versionnés, réutilisables par les campagnes
          </div>
        </div>
        <HelpButton contextKey="scripts" />
      </div>
      <ScriptsClient />
    </>
  );
}
