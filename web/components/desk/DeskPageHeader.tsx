"use client";

import { useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

export function DeskPageHeader() {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1>{t("Mon poste")}</h1>
        <div className="subtitle">
          {t("Ma file de rappels, contexte patient, softphone et pool partagé d'équipe.")}
        </div>
      </div>
      <HelpButton contextKey="desk" />
    </div>
  );
}
