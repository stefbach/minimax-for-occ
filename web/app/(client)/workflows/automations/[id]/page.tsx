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
          <h1>Edit automation</h1>
          <div className="subtitle">
            Trigger, filters and actions. Credentials are referenced by
            identifier — secrets never pass through here.
          </div>
        </div>
        <HelpButton contextKey="workflows.automation" />
      </div>
      <AutomationEditor id={id} />
    </div>
  );
}
