"use client";

import { useState } from "react";
import { TeamList } from "./TeamList";

/**
 * Client wrapper for the /team page. Owns the "open invite modal" signal so
 * the page can keep its server-rendered header (title + role gate) while the
 * "+ Invite" button still feels instant.
 */
export function TeamPageClient() {
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
      </div>
      <TeamList inviteOpenSignal={openSignal} />
    </>
  );
}
