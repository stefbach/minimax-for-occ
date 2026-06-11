"use client";

/**
 * Persistent softphone shell — wraps a SINGLE Softphone instance so its
 * Twilio Voice SDK Device, presence state and active call survive every
 * client-side route change. Before this, the Softphone lived inside
 * DeskWorkstation; navigating from /desk to /mes-patients unmounted it
 * and dropped any live call mid-sentence.
 *
 * Key invariant: ONE <Softphone /> element, always mounted at the layout
 * level. We toggle its `compact` prop to switch between:
 *   - Compact mode (sticky bar at the top of every page).
 *   - Full mode (slide-in drawer from the right) — same component
 *     instance, so the Twilio Device + calls list survive the visual
 *     swap intact.
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

  // ONE Softphone instance only — its parent wrapper toggles between
  // "in sticky bar" and "in drawer" styling. The Softphone component's
  // internal state (Twilio Device ref, presence, calls) lives on its
  // useRef/useState slots which React preserves across prop changes —
  // calls don't drop when the user clicks Étendre / Réduire.
  return (
    <>
      {/* Overlay backdrop — only visible when expanded. Clicking it closes
          the drawer (unless the click is inside the drawer itself). */}
      {expanded && (
        <div
          aria-hidden
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 59,
          }}
        />
      )}

      {/* The Softphone host. CSS swaps between sticky-bar and drawer
          positioning; the component element stays the same so React never
          unmounts it. */}
      <div
        className={expanded ? "softphone-shell expanded" : "softphone-shell compact"}
        role={expanded ? "dialog" : "region"}
        aria-modal={expanded ? "true" : undefined}
        aria-label="Softphone"
        style={
          expanded
            ? {
                position: "fixed",
                top: 0,
                right: 0,
                bottom: 0,
                width: "min(720px, 95vw)",
                background: "var(--bg)",
                boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
                overflow: "auto",
                zIndex: 60,
                padding: 16,
              }
            : {
                position: "sticky",
                top: 0,
                zIndex: 30,
                marginBottom: 14,
              }
        }
      >
        {expanded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16 }}>Mon poste</h2>
            <button
              className="ghost"
              onClick={() => setExpanded(false)}
              aria-label="Fermer (Échap)"
              style={{ padding: "5px 10px", fontSize: 13 }}
            >
              ✕ Fermer
            </button>
          </div>
        )}
        <Softphone compact={!expanded} onExpand={() => setExpanded(true)} />
      </div>
    </>
  );
}
