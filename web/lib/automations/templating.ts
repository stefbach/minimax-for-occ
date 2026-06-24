/**
 * Template rendering for automation steps.
 *
 * Steps reference the run context with {{ path }} tokens. The context starts
 * as the scanned row (table_scan) or the call input (callable automations) and
 * accumulates each step's named output, so later steps can read earlier
 * results — e.g. {{ patient_id }} from the trigger row, or {{ a2.dossier.id }}
 * from a call_automation step that stored its result under "a2".
 *
 * Paths are dot/bracket walks (a.b.c, a.0.b). Missing values render empty.
 * This is deliberately not a JS evaluator — the heavy per-agent logic lives in
 * typed step executors, not in user-supplied expressions.
 */

export type Ctx = Record<string, unknown>;

export function getPath(ctx: Ctx, path: string): unknown {
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Render a string template: "{{ email }}" → ctx.email. */
export function renderTemplate(tpl: string, ctx: Ctx): string {
  return String(tpl ?? "").replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, key: string) => {
    const v = getPath(ctx, key);
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/**
 * Resolve a value that may be a raw value, a "{{path}}" reference (returns the
 * referenced value with its original type when the token is the whole string),
 * or a string with embedded tokens (returns the interpolated string).
 */
export function resolveValue(input: unknown, ctx: Ctx): unknown {
  if (typeof input !== "string") return input;
  const whole = input.match(/^\{\{\s*([\w.[\]]+)\s*\}\}$/);
  if (whole) return getPath(ctx, whole[1]);
  if (input.includes("{{")) return renderTemplate(input, ctx);
  return input;
}

/** Deep-render an object/array's string values against the context. */
export function renderDeep<T>(obj: T, ctx: Ctx): T {
  if (typeof obj === "string") return resolveValue(obj, ctx) as T;
  if (Array.isArray(obj)) return obj.map((v) => renderDeep(v, ctx)) as unknown as T;
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = renderDeep(v, ctx);
    }
    return out as T;
  }
  return obj;
}

export function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s !== "" && s !== "false" && s !== "0" && s !== "null" && s !== "missing";
}
