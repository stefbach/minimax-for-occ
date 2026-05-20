/**
 * Shared helpers for the /api/analytics/* routes.
 */

import { LEGACY_ORG_ID } from "./constants";
import { requestOrgId } from "./request-org";

/** @deprecated import `LEGACY_ORG_ID` from `@/lib/constants` instead. */
export const DEFAULT_ORG = LEGACY_ORG_ID;

export type Range = { from: Date; to: Date };

/**
 * Parse `from`/`to` ISO query params, defaulting to the last 7 days
 * (ending at "now").
 */
export function parseRange(req: Request): Range {
  const { searchParams } = new URL(req.url);
  const toParam = searchParams.get("to");
  const fromParam = searchParams.get("from");

  const now = new Date();
  const to = toParam ? new Date(toParam) : now;
  const defaultFrom = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = fromParam ? new Date(fromParam) : defaultFrom;

  // Guard against invalid dates.
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { from: defaultFrom, to: now };
  }
  return { from, to };
}

/**
 * @deprecated use `requestOrgId` from `@/lib/request-org` (or `requireContext`
 * for routes that should reject unauthenticated callers). Kept as a thin
 * wrapper so existing analytics routes keep compiling — it now defers to
 * `requestOrgId`, which validates the query param against the user's
 * memberships instead of trusting it blindly.
 */
export function orgFromAsync(req: Request): Promise<string> {
  return requestOrgId(req);
}

/** @deprecated synchronous variant kept for legacy callers. */
export function orgFrom(req: Request): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("org_id") ?? DEFAULT_ORG;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoHour(d: Date): string {
  // YYYY-MM-DDTHH:00
  return d.toISOString().slice(0, 13) + ":00";
}

export function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    out.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function eachHour(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from);
  cur.setUTCMinutes(0, 0, 0);
  const end = new Date(to);
  while (cur <= end) {
    out.push(isoHour(cur));
    cur.setUTCHours(cur.getUTCHours() + 1);
  }
  return out;
}

/**
 * Maps a `disposition` (free text from agents/IVR) to a coarse bucket used
 * for the headline KPIs.
 */
export function dispositionBucket(
  state: string | null | undefined,
  disposition: string | null | undefined,
): "answered" | "abandoned" | "transferred" | "voicemail" | "other" {
  const d = (disposition ?? "").toLowerCase();
  if (d.includes("transfer")) return "transferred";
  if (d.includes("voicemail") || d.includes("vm")) return "voicemail";
  if (d.includes("abandon") || d.includes("missed") || d.includes("no_answer"))
    return "abandoned";
  if (d.includes("answer") || d.includes("done") || d.includes("completed"))
    return "answered";
  // Fallback on call state when disposition is empty.
  if (state === "failed" || state === "queued") return "abandoned";
  if (state === "ended") return "answered";
  return "other";
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}
