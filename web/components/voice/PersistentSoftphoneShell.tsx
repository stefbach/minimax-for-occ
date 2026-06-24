"use client";

/**
 * Persistent softphone shell — wraps a SINGLE Softphone instance so its
 * Twilio Voice SDK Device, presence state and active call survive every
 * client-side route change. Before this, the Softphone lived inside
 * DeskWorkstation; navigating from /desk to /mes-patients unmounted it
 * and dropped any live call mid-sentence.
 *
 * Key invariant: ONE <Softphone /> element, always mounted at the layout
 * level. React keeps the same fiber for it across every route change so
 * the Twilio Device + calls list survive intact.
 *
 * Wati 2026-06-15: the "Mon poste" UX was reworked. The shell used to
 * render the softphone in a fixed right-side drawer that slid in on top
 * of the page. Wati wanted the full poste UI (clavier + statut + notes
 * + appels récents) baked DIRECTLY into the /desk page, with the
 * top-right "Mon poste" pill just navigating there instead of opening
 * a drawer. We now:
 *
 *   - keep the <Softphone /> mounted at the layout level (call
 *     persistence unchanged),
 *   - portal it into a slot div (#desk-softphone-slot) that the /desk
 *     page renders inline at the top of its grid when the user is on
 *     /desk,
 *   - render it hidden (display:none) into a fallback container on every
 *     other page so the Twilio Device stays alive but takes no space,
 *   - swap the floating pill for a plain link to /desk; hidden when the
 *     user is already on that page.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Softphone } from "./Softphone";

/** Stable id of the DOM node the /desk page renders so we know where to
 *  portal the live Softphone element. Exported so DeskWorkstation can
 *  reference the same constant — keeps the contract obvious. */
export const DESK_SOFTPHONE_SLOT_ID = "desk-softphone-slot";

/** Kept for backwards compat: legacy code paths still call this to "open"
 *  the softphone. With the drawer gone there's nothing to open, so the
 *  helper is a no-op. We keep the export so existing imports keep
 *  type-checking and any future need to refocus the softphone has a
 *  natural hook. */
export function dispatchSoftphoneExpand() {
  /* no-op since Wati 2026-06-15 — drawer removed */
}

export function PersistentSoftphoneShell() {
  const t = useT();
  const pathname = usePathname();
  // /desk and /desk/<sub-route> are both treated as the agent's poste.
  // Everywhere else, the softphone sits hidden but mounted.
  const onDesk = pathname === "/desk" || pathname?.startsWith("/desk/");

  // Target DOM node for the inline slot. We resolve it AFTER the children
  // (the /desk page) have rendered so the slot is in the tree. A small
  // poll covers the gap between layout effect on this shell and the
  // child page committing — Next renders client components in document
  // order so usually it's there on the first check.
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!onDesk) {
      setSlotEl(null);
      return;
    }
    let cancelled = false;
    const tryGrab = () => {
      if (cancelled) return;
      const el = document.getElementById(DESK_SOFTPHONE_SLOT_ID);
      if (el) {
        setSlotEl(el);
      } else {
        // Re-check on the next animation frame until the page mounts the
        // slot. Bounded to a handful of frames so we don't keep polling
        // forever on pages that don't expose one.
        requestAnimationFrame(tryGrab);
      }
    };
    tryGrab();
    return () => {
      cancelled = true;
    };
  }, [onDesk, pathname]);

  // The hidden fallback container: stays in the DOM on every route so the
  // Softphone has a stable mount point, and just gets `display: none` so
  // it doesn't take space. When the portal target appears, React moves
  // the Softphone there without unmounting it.
  return (
    <>
      {/* Inline slot — when the user is on /desk we portal the Softphone
          into the page's #desk-softphone-slot div. */}
      {slotEl && createPortal(<Softphone />, slotEl)}

      {/* Hidden fallback mount — keeps the Softphone alive on every other
          route. We only render it here when we DON'T have an inline slot,
          so the same JSX element is never mounted twice. */}
      {!slotEl && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            // Off-screen but rendered, so Twilio Device + LiveKit Room can
            // initialise and answer calls without grabbing focus. display:
            // none would tear down media elements on some browsers, so we
            // stick with the off-screen trick used by most modal toolkits.
            top: 0,
            left: -99999,
            width: 1,
            height: 1,
            overflow: "hidden",
            pointerEvents: "none",
            opacity: 0,
          }}
        >
          <Softphone />
        </div>
      )}

      {/* Floating "Mon poste" pill — top-right of every page EXCEPT
          /desk itself (since the user is already there). Plain link to
          /desk, no drawer, no event dispatch. */}
      {!onDesk && (
        <Link
          href="/desk"
          aria-label="Aller à Mon poste"
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
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>☎</span>
          <span>{t("Mon poste")}</span>
        </Link>
      )}
    </>
  );
}
