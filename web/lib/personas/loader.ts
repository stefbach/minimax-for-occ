/**
 * Filesystem loader for the persona library. Reads markdown files from the
 * `personas/` directory at the repo root.
 *
 * Locating the directory: we look in a few candidate paths so this works
 * locally (where cwd is `web/`) and on Vercel (where cwd is the package root)
 * — same pattern as `lib/help` and `app/(app)/help/page.tsx`.
 */

import { promises as fs } from "fs";
import path from "path";
import { parsePersona, type ParsedPersona, type PersonaFrontmatter } from "./parser";

export type PersonaSummary = {
  slug: string;
  title: string;
  industry: string;
  language: string;
  tags: string[];
  voice_suggestion: string | null;
  llm_model: string | null;
  max_call_duration_secs: number | null;
  n8n_bindings_suggested: string[];
  handoff_team_suggested: string | null;
  /** Filesystem path relative to repo root, useful for debugging. */
  path: string;
  /** Short ~200 chars description for cards. */
  description: string;
};

export type PersonaDetail = PersonaSummary & {
  body: string;
  frontmatter: PersonaFrontmatter;
};

async function findPersonasRoot(): Promise<string | null> {
  const candidates = [
    // running from web/ (most cases)
    path.resolve(process.cwd(), "../personas"),
    // running from repo root
    path.resolve(process.cwd(), "personas"),
    // explicit env override
    process.env.AXON_PERSONAS_PATH || "",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) return p;
    } catch {
      // try next
    }
  }
  return null;
}

async function listMdFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && full.endsWith(".md") && !full.endsWith("README.md")) {
        out.push(full);
      }
    }
  }
  return out;
}

function toSummary(parsed: ParsedPersona, file: string, root: string): PersonaSummary | null {
  const fm = parsed.frontmatter;
  const slug = typeof fm.slug === "string" ? fm.slug : path.basename(file, ".md");
  const title = typeof fm.title === "string" ? fm.title : slug;
  // industry fallback = parent folder name
  const rel = path.relative(root, file);
  const parts = rel.split(path.sep);
  const industry =
    typeof fm.industry === "string" ? fm.industry : parts.length > 1 ? parts[0] : "uncategorized";
  const language = typeof fm.language === "string" ? fm.language : "multi";
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
  const n8n = Array.isArray(fm.n8n_bindings_suggested)
    ? fm.n8n_bindings_suggested.map(String)
    : [];
  const description = shortDescription(parsed.body);
  return {
    slug,
    title,
    industry,
    language,
    tags,
    voice_suggestion: typeof fm.voice_suggestion === "string" ? fm.voice_suggestion : null,
    llm_model: typeof fm.llm_model === "string" ? fm.llm_model : null,
    max_call_duration_secs:
      typeof fm.max_call_duration_secs === "number" ? fm.max_call_duration_secs : null,
    n8n_bindings_suggested: n8n,
    handoff_team_suggested:
      typeof fm.handoff_team_suggested === "string" ? fm.handoff_team_suggested : null,
    path: rel,
    description,
  };
}

function shortDescription(body: string, max = 200): string {
  const cleaned = body
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/** List all personas. Returns [] if the directory is missing (graceful fallback). */
export async function listPersonas(): Promise<PersonaSummary[]> {
  const root = await findPersonasRoot();
  if (!root) return [];
  const files = await listMdFiles(root);
  const summaries: PersonaSummary[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(f, "utf-8");
      const parsed = parsePersona(raw);
      const s = toSummary(parsed, f, root);
      if (s) summaries.push(s);
    } catch {
      // ignore broken files
    }
  }
  summaries.sort((a, b) => a.title.localeCompare(b.title));
  return summaries;
}

/** Get full persona detail by slug. Returns null if not found. */
export async function getPersona(slug: string): Promise<PersonaDetail | null> {
  const root = await findPersonasRoot();
  if (!root) return null;
  const files = await listMdFiles(root);
  for (const f of files) {
    try {
      const raw = await fs.readFile(f, "utf-8");
      const parsed = parsePersona(raw);
      const fmSlug =
        typeof parsed.frontmatter.slug === "string"
          ? parsed.frontmatter.slug
          : path.basename(f, ".md");
      if (fmSlug === slug) {
        const s = toSummary(parsed, f, root);
        if (!s) return null;
        return { ...s, body: parsed.body, frontmatter: parsed.frontmatter };
      }
    } catch {
      // skip
    }
  }
  return null;
}
