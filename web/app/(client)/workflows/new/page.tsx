import { TEMPLATES } from "@/lib/workflow-templates";
import { CreateWorkflowForm } from "@/components/workflow/CreateWorkflowForm";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function NewWorkflowPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nouveau workflow</h1>
          <div className="subtitle">
            Choisissez un template prêt à l&apos;emploi. Le workflow sera créé sur votre instance n8n,
            tagué <span className="kbd">voice-agent</span> et accessible immédiatement.
          </div>
        </div>
        <HelpButton contextKey="workflows" />
      </div>
      <CreateWorkflowForm templates={TEMPLATES.map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
      }))} />
    </>
  );
}
