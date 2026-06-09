import { MyPatientsClient } from "@/components/desk/MyPatientsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function MesPatientsPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mes patients</h1>
          <div className="subtitle">
            Liste complète des patients que tu as traités, avec recherche
            et filtres. Cliquer une ligne ouvre le détail dans Mon poste.
          </div>
        </div>
        <HelpButton contextKey="desk.my-patients" />
      </div>
      <MyPatientsClient />
    </div>
  );
}
