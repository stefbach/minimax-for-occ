import Link from "next/link";
import { ApprovalsClient } from "@/components/workflows/ApprovalsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>À valider</h1>
          <div className="subtitle">
            Les emails et messages rédigés par tes agents, en attente de ton approbation avant envoi.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/workflows"><button className="ghost">← Workflows</button></Link>
          <HelpButton contextKey="workflows" />
        </div>
      </div>
      <ApprovalsClient />
    </>
  );
}
