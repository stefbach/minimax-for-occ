"use client";

import { useEffect } from "react";

/**
 * On mount, if the URL has a hash, scroll the matching element into view.
 * This is helpful because the app shell already has its own scroll context,
 * and the default browser anchor scroll can land in the wrong frame.
 */
export function HelpPageScroller() {
  useEffect(() => {
    const hash =
      typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!hash) return;
    // Defer to let the layout settle.
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => clearTimeout(t);
  }, []);
  return null;
}
