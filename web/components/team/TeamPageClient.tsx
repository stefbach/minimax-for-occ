"use client";

import { useState } from "react";
import { TeamList } from "./TeamList";
import { useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

/**
 * Client wrapper for the /team page. Owns the "open invite modal" signal so
 * the page can keep its server-rendered header (title + role gate) while the
 * "+ Invite" button still feels instant.
 */
export function TeamPageClient() {
  const t = useT();
  const [openSignal, setOpenSignal] = useState(0);
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <div className="subtitle">
            Manage your organisation's users, their roles and access.
          </div>
        </div>
        <button onClick={() => setOpenSignal((n) => n + 1)}>+ Invite</button>
        <HelpButton contextKey="team" />
      </div>
      <TeamList inviteOpenSignal={openSignal} />
    </>
  );
}
