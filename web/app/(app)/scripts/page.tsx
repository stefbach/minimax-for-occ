import { ScriptsClient } from "@/components/scripts/ScriptsClient";

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
      </div>
      <ScriptsClient />
    </>
  );
}
