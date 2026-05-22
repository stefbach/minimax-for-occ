/**
 * Minimal YAML frontmatter parser/serializer for Axon personas.
 *
 * We deliberately avoid pulling in `gray-matter`, `js-yaml` or `remark` so the
 * server bundle stays small. The persona format only needs:
 *   key: value                 — string / number / boolean
 *   key: [a, b, c]             — inline list
 *   key:                       — block list (followed by "- item" lines)
 *     - item
 *     - item
 *
 * Anything more advanced (nested objects, multiline scalars, anchors) is NOT
 * supported and will be rendered as a plain string.
 */

export type PersonaFrontmatter = {
  slug?: string;
  title?: string;
  industry?: string;
  language?: string;
  voice_suggestion?: string;
  llm_model?: string;
  max_call_duration_secs?: number;
  tags?: string[];
  n8n_bindings_suggested?: string[];
  handoff_team_suggested?: string;
  // Custom fields are allowed — we keep them as unknown.
  [key: string]: unknown;
};

export type ParsedPersona = {
  frontmatter: PersonaFrontmatter;
  body: string;
};

const FENCE_RE = /^---\s*$/;

/**
 * Parse a raw markdown document with optional YAML-ish frontmatter.
 * Returns { frontmatter, body }. If no frontmatter is present, returns
 * { frontmatter: {}, body: rawMarkdown }.
 */
export function parsePersona(rawMarkdown: string): ParsedPersona {
  const text = rawMarkdown.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines.length === 0 || !FENCE_RE.test(lines[0])) {
    return { frontmatter: {}, body: text };
  }
  // Find closing fence
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: {}, body: text };
  }
  const yamlLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  const frontmatter = parseYaml(yamlLines);
  return { frontmatter, body };
}

/** Parse a small subset of YAML (see file header for grammar). */
function parseYaml(yamlLines: string[]): PersonaFrontmatter {
  const out: PersonaFrontmatter = {};
  let i = 0;
  while (i < yamlLines.length) {
    const raw = yamlLines[i];
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    // top-level key: value or key: with block list below
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();

    if (rest === "") {
      // possible block list
      const items: string[] = [];
      let j = i + 1;
      while (j < yamlLines.length) {
        const next = yamlLines[j];
        const nm = next.match(/^\s+-\s+(.*)$/);
        if (!nm) break;
        items.push(stripQuotes(nm[1].trim()));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
        continue;
      }
      // empty value → empty string
      out[key] = "";
      i++;
      continue;
    }

    // inline list: [a, b, "c d"]
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      if (inner === "") {
        out[key] = [];
      } else {
        out[key] = splitInlineList(inner).map(stripQuotes);
      }
      i++;
      continue;
    }

    // scalar
    out[key] = coerceScalar(stripQuotes(rest));
    i++;
  }
  return out;
}

function splitInlineList(s: string): string[] {
  const result: string[] = [];
  let buf = "";
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      buf += c;
      continue;
    }
    if (c === ",") {
      result.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== "") result.push(buf.trim());
  return result;
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function coerceScalar(s: string): string | number | boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

/**
 * Serialize { frontmatter, body } back to a markdown document with YAML
 * frontmatter delimited by ---. Round-trip safe for the subset we support.
 */
export function serializePersona(p: ParsedPersona): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(p.frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every((v) => typeof v === "string" && !/[\s,:]/.test(v))) {
        // safe inline
        lines.push(`${key}: [${value.join(", ")}]`);
      } else {
        lines.push(`${key}:`);
        for (const v of value) lines.push(`  - ${formatScalar(v)}`);
      }
      continue;
    }
    lines.push(`${key}: ${formatScalar(value)}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(p.body.replace(/^\n+/, ""));
  return lines.join("\n");
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  // Quote if contains characters that would break our parser.
  if (/[:#]/.test(s) || s.startsWith("-") || s.startsWith("[")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Convenience helper that returns the first ~200 chars of the body, stripped
 * of headings, used as a short description for marketplace cards.
 */
export function shortDescription(body: string, max = 200): string {
  const cleaned = body
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
