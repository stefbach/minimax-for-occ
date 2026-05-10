import { AgentForm } from "@/components/agent/AgentForm";

export default function NewAgentPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nouvel agent</h1>
          <div className="subtitle">Définissez la voix, le cerveau et le contexte.</div>
        </div>
      </div>
      <AgentForm />
    </>
  );
}
