/**
 * Tiny structured logger shared across web/ route handlers and lib helpers.
 *
 * Renders log lines like:
 *   [INFO ] [org=org-1 call=call-9 user=u-2] handoff requested -> agent-3
 *
 * Why not pino/winston? We stay in a Vercel Edge-compatible subset (no fs,
 * no async iterators), and the structured prefix is enough for Vercel /
 * Fly's log aggregator filters. If we later need OTEL spans, this is the
 * single place to swap.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  /** Org id the operation belongs to. */
  org?: string | null;
  /** Active call id (calls.id). */
  call?: string | null;
  /** Acting user id (auth.users.id). */
  user?: string | null;
  /** Free-form extra key/value pairs serialized at the end. */
  [key: string]: unknown;
}

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

function formatPrefix(ctx?: LogContext): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.org) parts.push(`org=${ctx.org}`);
  if (ctx.call) parts.push(`call=${ctx.call}`);
  if (ctx.user) parts.push(`user=${ctx.user}`);
  // Optional extras
  for (const [k, v] of Object.entries(ctx)) {
    if (k === "org" || k === "call" || k === "user") continue;
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

function emit(level: LogLevel, msg: string, ctx?: LogContext): void {
  const line = `[${LEVEL_TAG[level]}]${formatPrefix(ctx)} ${msg}`;
  const sink: Record<LogLevel, (...args: unknown[]) => void> = {
    debug: console.debug,
    info: console.log,
    warn: console.warn,
    error: console.error,
  };
  sink[level](line);
}

/** Structured log helper. Prefer this over bare `console.log` in route code. */
export const log = {
  debug(msg: string, ctx?: LogContext) {
    emit("debug", msg, ctx);
  },
  info(msg: string, ctx?: LogContext) {
    emit("info", msg, ctx);
  },
  warn(msg: string, ctx?: LogContext) {
    emit("warn", msg, ctx);
  },
  error(msg: string, ctx?: LogContext) {
    emit("error", msg, ctx);
  },
};

/** Generic entry point — equivalent to log[level](msg, ctx). */
export function logEvent(level: LogLevel, msg: string, ctx?: LogContext): void {
  emit(level, msg, ctx);
}
