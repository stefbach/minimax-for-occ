"use client";

import { useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

export function MesPatientsPageHeader() {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1>{t("Mes patients")}</h1>
        <div className="subtitle">
          {t("Liste complète des patients que tu as traités, avec recherche et filtres. Cliquer une ligne ouvre le détail dans Mon poste.")}
        </div>
      </div>
      <HelpButton contextKey="desk.my-patients" />
    </div>
  );
}
