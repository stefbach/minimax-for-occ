import { AgentForm } from "@/components/agent/AgentForm";
import { HelpButton } from "@/components/help/HelpButton";

export default function NewAgentPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nouvel agent</h1>
          <div className="subtitle">Définissez la voix, le cerveau et le contexte.</div>
        </div>
        <HelpButton contextKey="agents.detail" />
      </div>
      <AgentForm />
    </>
  );
}
