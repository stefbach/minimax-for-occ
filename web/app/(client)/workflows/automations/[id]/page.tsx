import { AutomationEditor } from "@/components/workflows/AutomationEditor";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default async function AutomationEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Éditer l&apos;automation</h1>
          <div className="subtitle">
            Déclencheur, filtres et actions. Les credentials sont référencés
            par identifiant — les secrets ne transitent jamais ici.
          </div>
        </div>
        <HelpButton contextKey="workflows.automation" />
      </div>
      <AutomationEditor id={id} />
    </div>
  );
}
