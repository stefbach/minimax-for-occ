"use client";

import { useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

export function SuperviseLivePageHeader() {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1>{t("Supervision live")}</h1>
        <div className="subtitle">
          {t("Qui est en ligne, qui parle avec qui, depuis combien de temps. Mise à jour automatique toutes les 5 secondes.")}
        </div>
      </div>
      <HelpButton contextKey="supervise.live" />
    </div>
  );
}
