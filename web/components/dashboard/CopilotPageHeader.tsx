"use client";

import { useT } from "@/lib/i18n";

export function CopilotPageHeader() {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1>Co-pilot manager</h1>
        <div className="subtitle">
          {t("Pose une question en langage naturel sur l'activité de tes appels.")}
        </div>
      </div>
    </div>
  );
}
