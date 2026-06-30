"use client";

/**
 * Minimal skeleton loader: shimmering rectangular block.
 *
 * Used to replace bare "Chargement…" strings when we want a fuller cue while
 * data is loading. Composes well — render several to mimic list rows.
 */

import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n";

export function Skeleton({
  width,
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: width ?? "100%",
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--panel-2) 0%, var(--border-2) 50%, var(--panel-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "axon-skeleton 1.2s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * Convenience: stack of N skeleton lines (for list/table loading states).
 */
export function SkeletonRows({
  count = 4,
  height = 14,
  gap = 10,
}: {
  count?: number;
  height?: number;
  gap?: number;
}) {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={t("Chargement")}
      style={{ display: "flex", flexDirection: "column", gap }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} width={`${85 - (i % 3) * 10}%`} />
      ))}
      <style>{`
        @keyframes axon-skeleton {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
