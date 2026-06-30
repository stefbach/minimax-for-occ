"use client";

import { useT } from "@/lib/i18n";

export function MyCalendarPageHeader() {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1>{t("Mon calendrier")}</h1>
        <div className="subtitle">
          {t("Mes rappels et suivis à venir, groupés par jour.")}
        </div>
      </div>
    </div>
  );
}
