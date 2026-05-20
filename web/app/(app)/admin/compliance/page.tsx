import { ComplianceClient } from "@/components/admin/ComplianceClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function CompliancePage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Conformité</h1>
          <div className="subtitle">
            Gestion des numéros DNC (Do Not Call) de l&apos;organisation —
            obligatoire en TCPA / e-Privacy.
          </div>
        </div>
        <HelpButton contextKey="admin.compliance" />
      </div>
      <ComplianceClient />
    </>
  );
}
