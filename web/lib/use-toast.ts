"use client";

/**
 * Minimal in-house toast hook + context (no external deps).
 *
 * Usage:
 *   // wrap your tree once
 *   <ToastProvider>{children}</ToastProvider>
 *
 *   // anywhere downstream
 *   const toast = useToast();
 *   toast.success("Saved");
 *   toast.error("Boom");
 *   toast.info("Hint");
 *
 * Toasts auto-dismiss after 4s and stack vertically in the bottom-right.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

export interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  dismiss: (id: string) => void;
}

interface ToastInternalState {
  toasts: ToastItem[];
  api: ToastApi;
}

const ToastContext = createContext<ToastInternalState | null>(null);
export const TOAST_DURATION_MS = 4000;

export function useToastInternal(): ToastInternalState {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast must be used inside <ToastProvider>. Wrap your layout with it.",
    );
  }
  return ctx;
}

export function useToast(): ToastApi {
  return useToastInternal().api;
}

export { ToastContext };

/**
 * State hook used by ToastProvider. Kept in lib/ so the consumer (Toast.tsx)
 * stays tiny and only handles rendering.
 */
export function useToastState(): ToastInternalState {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const t = timers.current[id];
    if (t) {
      clearTimeout(t);
      delete timers.current[id];
    }
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((cur) => [...cur, { id, variant, message }]);
      timers.current[id] = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      dismiss,
    }),
    [push, dismiss],
  );

  return { toasts, api };
}
