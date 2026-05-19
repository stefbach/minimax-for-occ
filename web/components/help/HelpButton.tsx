"use client";

import { useState } from "react";
import { HelpDrawer } from "./HelpDrawer";

/**
 * Small "?" button to drop into any page header. Opens a side drawer with
 * contextual help. The drawer pulls content from `lib/help/registry.ts`
 * keyed by `contextKey` and the user's current role.
 */
export function HelpButton({ contextKey }: { contextKey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Aide contextuelle"
        aria-label="Ouvrir l'aide contextuelle"
        style={{
          background: "transparent",
          border: "1px solid var(--border, #2a2f3a)",
          color: "inherit",
          borderRadius: 999,
          width: 32,
          height: 32,
          fontSize: 16,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <HelpDrawer contextKey={contextKey} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
