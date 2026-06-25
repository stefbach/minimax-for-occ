"use client";

import { useT } from "@/lib/i18n";

export function SupervisePageHeader() {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1>{t("Supervision")}</h1>
        <div className="subtitle">
          {t("Tous les leads en attente — assignation, suivi et création manuelle.")}
        </div>
      </div>
    </div>
  );
}
