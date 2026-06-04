"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { TeamList } from "./TeamList";

/**
 * Client wrapper for the /team page. Owns the "open invite modal" signal so
 * the page can keep its server-rendered header (title + role gate) while the
 * "+ Inviter" button still feels instant.
 */
export function TeamPageClient() {
  const t = useT();
  const [openSignal, setOpenSignal] = useState(0);
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t("Équipe")}</h1>
          <div className="subtitle">
            {t("Gérez les utilisateurs de votre organisation, leurs rôles et leurs accès.")}
          </div>
        </div>
        <button onClick={() => setOpenSignal((n) => n + 1)}>+ {t("Inviter")}</button>
      </div>
      <TeamList inviteOpenSignal={openSignal} />
    </>
  );
}
