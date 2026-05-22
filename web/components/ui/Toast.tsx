"use client";

/**
 * In-house toast renderer.
 *
 * - <ToastProvider> wires up state + portal into the app shell.
 * - Visuals match the rest of the app (panel + accent borders).
 * - Pure CSS-in-JSX, no extra deps.
 */

import { useMemo } from "react";
import {
  ToastContext,
  useToastState,
  type ToastItem,
  type ToastVariant,
} from "@/lib/use-toast";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const state = useToastState();
  return (
    <ToastContext.Provider value={state}>
      {children}
      <ToastViewport toasts={state.toasts} onDismiss={state.api.dismiss} />
    </ToastContext.Provider>
  );
}

function variantStyle(v: ToastVariant): {
  border: string;
  bg: string;
  fg: string;
  icon: string;
} {
  if (v === "success") {
    return {
      border: "var(--good)",
      bg: "rgba(74, 222, 128, 0.10)",
      fg: "var(--good)",
      icon: "✓",
    };
  }
  if (v === "error") {
    return {
      border: "var(--bad)",
      bg: "rgba(248, 113, 113, 0.10)",
      fg: "var(--bad)",
      icon: "!",
    };
  }
  return {
    border: "var(--info)",
    bg: "rgba(96, 165, 250, 0.10)",
    fg: "var(--info)",
    icon: "i",
  };
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const portalStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "fixed",
      right: 18,
      bottom: 18,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      zIndex: 9999,
      maxWidth: 380,
      pointerEvents: "none",
    }),
    [],
  );

  return (
    <div style={portalStyle} aria-live="polite" aria-atomic="false">
      {toasts.map((t) => {
        const s = variantStyle(t.variant);
        return (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            style={{
              pointerEvents: "auto",
              background: "var(--panel)",
              border: `1px solid ${s.border}`,
              borderLeft: `4px solid ${s.border}`,
              borderRadius: 8,
              padding: "10px 12px 10px 14px",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              minWidth: 260,
              animation: "axon-toast-in 160ms ease-out",
            }}
          >
            <span
              aria-hidden
              style={{
                background: s.bg,
                color: s.fg,
                fontWeight: 700,
                width: 22,
                height: 22,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                fontSize: 13,
                flex: "0 0 auto",
              }}
            >
              {s.icon}
            </span>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
              {t.message}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fermer la notification"
              className="ghost"
              style={{
                padding: "2px 8px",
                fontSize: 12,
                minWidth: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes axon-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
