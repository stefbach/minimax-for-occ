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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Softphone } from "./Softphone";
import { useT } from "@/lib/i18n";

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
  const onDesk = pathname === "/desk" || pathname?.startsWith("/desk/");

  // Grab the DOM slot that the /desk page renders so Softphone can portal
  // its visible UI there. Polled via rAF until the child page commits.
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
        requestAnimationFrame(tryGrab);
      }
    };
    tryGrab();
    return () => { cancelled = true; };
  }, [onDesk, pathname]);

  // ONE stable off-screen container — Softphone is NEVER unmounted or moved
  // in the React tree. The deskSlotEl prop lets it portal its visible UI
  // into the /desk page slot without changing its own mount point.
  // This prevents the previous bug where navigating to/from /desk triggered
  // an unmount → sendBeacon("offline") → remount cycle that reset presence.
  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: -99999,
          width: 1,
          height: 1,
          overflow: "hidden",
          pointerEvents: "none",
          opacity: 0,
        }}
      >
        <Softphone deskSlotEl={slotEl} />
      </div>

      {/* "Mon poste" pill — visible on every page except /desk itself. */}
      {!onDesk && (
        <Link
          href="/desk"
          aria-label={t("Aller à mon poste")}
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
