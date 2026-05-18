/**
 * Evaluate a simple JSON-path condition against an analysis result.
 *
 * Condition shape:
 *   { path: "sentiment", op: "<", value: 0.2 }
 *   { path: "tags",      op: "includes", value: "negative" }
 *   { path: "score",     op: ">=", value: 0.8 }
 *
 * Supported operators:
 *   "<" | "<=" | ">" | ">=" | "==" | "!="    — numeric / string compare
 *   "includes"                                 — array contains value
 *   "exists"                                   — path resolves to non-undefined
 *   "matches"                                  — regex test (value treated as pattern)
 *
 * Returns true if the rule fires, false otherwise. Never throws on bad input.
 */

export interface AlertCondition {
  path: string;
  op:
    | "<"
    | "<="
    | ">"
    | ">="
    | "=="
    | "!="
    | "includes"
    | "exists"
    | "matches";
  value?: unknown;
}

export interface AlertRuleLike {
  id: string;
  org_id: string;
  name: string;
  policy_id: string | null;
  condition: AlertCondition | Record<string, unknown> | null;
  severity: "info" | "warn" | "critical" | string;
  enabled: boolean;
}

/** Walk a dotted/bracket path through a JSON-ish object. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

export function evaluateCondition(
  cond: AlertCondition | Record<string, unknown> | null | undefined,
  result: unknown,
): boolean {
  if (!cond || typeof cond !== "object") return false;
  const c = cond as AlertCondition;
  if (!c.op || typeof c.path !== "string") return false;

  const actual = getPath(result, c.path);

  switch (c.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "==":
      return actual === c.value;
    case "!=":
      return actual !== c.value;
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const a = toNumber(actual);
      const b = toNumber(c.value);
      if (a === null || b === null) return false;
      if (c.op === "<") return a < b;
      if (c.op === "<=") return a <= b;
      if (c.op === ">") return a > b;
      return a >= b;
    }
    case "includes":
      if (Array.isArray(actual)) return actual.includes(c.value);
      if (typeof actual === "string" && typeof c.value === "string") {
        return actual.includes(c.value);
      }
      return false;
    case "matches": {
      if (typeof actual !== "string" || typeof c.value !== "string") return false;
      try {
        return new RegExp(c.value).test(actual);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Convenience: also surface the value matched, for alert payload context. */
export function evaluateRule(
  rule: AlertRuleLike,
  result: unknown,
): { matched: boolean; actual: unknown } {
  if (!rule.enabled) return { matched: false, actual: undefined };
  const cond = rule.condition as AlertCondition | null;
  const actual = cond?.path ? getPath(result, cond.path) : undefined;
  return { matched: evaluateCondition(cond, result), actual };
}
