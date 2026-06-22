"use client";

/**
 * Persistent softphone shell — wraps a SINGLE Softphone instance so its
 * Twilio Voice SDK Device, presence state and active call survive every
 * client-side route change. Before this, the Softphone lived inside
 * DeskWorkstation; navigating from /desk to /mes-patients unmounted it
 * and dropped any live call mid-sentence.
 *
 * Key invariant: ONE <Softphone /> element, always mounted at the layout
 * level. We toggle the parent wrapper's visual mode via CSS (sticky bar
 * vs. fixed drawer); the Softphone itself is always rendered in the same
 * JSX slot under a stable key, so React's reconciler keeps the same
 * fiber across every toggle. Twilio Device + calls list survive intact.
 *
 * DeskWorkstation no longer renders its own <Softphone />. It dispatches a
 * `axon:softphone:expand` event on mount, which we listen for here so
 * navigating to /desk feels the same as before — the drawer slides open
 * automatically.
 */

import { useEffect, useState } from "react";
import { Softphone } from "./Softphone";

const EXPAND_EVENT = "axon:softphone:expand";

/** Programmatic expander — DeskWorkstation calls this on mount so opening
 *  /desk automatically reveals the full softphone view. */
export function dispatchSoftphoneExpand() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EXPAND_EVENT));
}

export function PersistentSoftphoneShell() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setExpanded(true);
    window.addEventListener(EXPAND_EVENT, handler);
    return () => window.removeEventListener(EXPAND_EVENT, handler);
  }, []);

  // ESC closes the drawer.
  useEffect(() => {
    if (!expanded || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <>
      {/* Backdrop overlay — always in the DOM but only visible when expanded.
          Pointer events disabled when hidden so it doesn't intercept clicks. */}
      <div
        aria-hidden
        onClick={() => setExpanded(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 59,
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? "auto" : "none",
          transition: "opacity 0.15s",
        }}
      />

      {/* Drawer — ALWAYS in the DOM at the same JSX position. Visibility +
          positioning toggled via CSS only, so React never tears the
          Softphone subtree down. */}
      <div
        className="softphone-shell"
        role={expanded ? "dialog" : "region"}
        aria-modal={expanded ? "true" : undefined}
        aria-label="Softphone"
        aria-hidden={!expanded}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(1200px, 96vw)",
          background: "var(--bg)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
          overflow: "auto",
          zIndex: 60,
          padding: 16,
          transform: expanded ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.18s ease-out",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("Mon poste")}</h2>
          <button
            className="ghost"
            onClick={() => setExpanded(false)}
            aria-label={t("Fermer (Échap)")}
            style={{ padding: "5px 10px", fontSize: 13 }}
          >
            ✕ {t("Fermer")}
          </button>
        </div>
        <Softphone />
      </div>

      {/* Compact pill — fixed in the top-right corner, always visible,
          shows current presence + active call status and acts as the
          "Étendre" button when the drawer is closed. */}
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Ouvrir le softphone"
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            zIndex: 40,
            padding: "8px 14px",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>☎</span>
          <span>{t("Mon poste")}</span>
        </button>
      )}
    </>
  );
}
