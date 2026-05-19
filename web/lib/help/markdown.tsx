/**
 * Shared mini-markdown renderer for the contextual help system.
 *
 * Supported syntax (intentionally small subset, no external dep):
 *   ## Heading 2
 *   ### Heading 3
 *   - bullet (consecutive lines grouped into <ul>)
 *   1. numbered (consecutive lines grouped into <ol>)
 *   > blockquote (consecutive lines grouped)
 *   ```                              <- fenced code block (any token after the ``` is ignored)
 *   code line
 *   ```
 *   `inline code`
 *   **bold**  *italic*  [text](url)
 *   blank line = paragraph break
 *
 * We deliberately keep this in JS-land instead of pulling in `remark` so the
 * help bundle stays tiny.
 */

import type { ReactNode } from "react";

export type MarkdownTheme = {
  /** Color used for links. */
  link?: string;
  /** Background for inline `code` and ``` code blocks. */
  codeBg?: string;
  /** Foreground color for code. */
  codeFg?: string;
  /** Border used for blockquote vertical bar. */
  quoteBorder?: string;
};

const DEFAULTS: Required<MarkdownTheme> = {
  link: "var(--accent-2, #6aa0ff)",
  codeBg: "rgba(127, 127, 127, 0.15)",
  codeFg: "var(--fg, inherit)",
  quoteBorder: "var(--border, #2a2f3a)",
};

/** Inline span renderer: handles links, bold, italic, inline code. */
export function renderInline(text: string, theme: MarkdownTheme = {}): ReactNode[] {
  const t = { ...DEFAULTS, ...theme };
  // Order matters: inline code first (it disables other interpretations),
  // then links, then bold, then italic.
  const re =
    /(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/;
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const match = re.exec(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }
    if (match.index > 0) nodes.push(remaining.slice(0, match.index));

    if (match[1]) {
      // inline code
      nodes.push(
        <code
          key={`c-${key++}`}
          style={{
            background: t.codeBg,
            color: t.codeFg,
            padding: "1px 6px",
            borderRadius: 4,
            fontSize: "0.92em",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {match[2]}
        </code>
      );
    } else if (match[3]) {
      // link
      const href = match[5];
      const isInternal = href.startsWith("/") || href.startsWith("#");
      nodes.push(
        <a
          key={`l-${key++}`}
          href={href}
          target={isInternal ? undefined : "_blank"}
          rel={isInternal ? undefined : "noreferrer"}
          style={{ color: t.link }}
        >
          {match[4]}
        </a>
      );
    } else if (match[6]) {
      nodes.push(<strong key={`b-${key++}`}>{match[7]}</strong>);
    } else if (match[8]) {
      nodes.push(<em key={`i-${key++}`}>{match[9]}</em>);
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return nodes;
}

type BlockOptions = {
  theme?: MarkdownTheme;
  /** If true, h2 elements receive an `id` derived from a sectionId callback. */
  headingIds?: boolean;
  /** Optional resolver that turns an h2 text into a stable id. */
  resolveHeadingId?: (text: string, level: 2 | 3) => string | undefined;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Block renderer. Returns a React fragment. */
export function renderMarkdown(
  md: string,
  options: BlockOptions = {}
): ReactNode {
  const theme = { ...DEFAULTS, ...(options.theme ?? {}) };
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const idFor = (text: string, level: 2 | 3): string | undefined => {
    if (!options.headingIds) return undefined;
    if (options.resolveHeadingId) {
      const id = options.resolveHeadingId(text, level);
      if (id !== undefined) return id;
    }
    return slugify(text);
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    // blank
    if (line === "") {
      i++;
      continue;
    }

    // fenced code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      blocks.push(
        <pre
          key={`pre-${key++}`}
          style={{
            background: theme.codeBg,
            color: theme.codeFg,
            padding: "10px 12px",
            borderRadius: 6,
            overflowX: "auto",
            margin: "10px 0",
            fontSize: "0.88em",
            lineHeight: 1.5,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // h2
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const id = idFor(text, 2);
      blocks.push(
        <h3
          key={`h2-${key++}`}
          id={id}
          style={{
            margin: "20px 0 8px",
            fontSize: 16,
            scrollMarginTop: 80,
          }}
        >
          {renderInline(text, theme)}
        </h3>
      );
      i++;
      continue;
    }

    // h3
    if (line.startsWith("### ")) {
      const text = line.slice(4);
      const id = idFor(text, 3);
      blocks.push(
        <h4
          key={`h3-${key++}`}
          id={id}
          style={{
            margin: "14px 0 6px",
            fontSize: 14,
            opacity: 0.95,
            scrollMarginTop: 80,
          }}
        >
          {renderInline(text, theme)}
        </h4>
      );
      i++;
      continue;
    }

    // h1 (rare in registry but used in USER_GUIDE.md)
    if (line.startsWith("# ")) {
      const text = line.slice(2);
      const id = idFor(text, 2);
      blocks.push(
        <h2
          key={`h1-${key++}`}
          id={id}
          style={{
            margin: "24px 0 10px",
            fontSize: 22,
            scrollMarginTop: 80,
          }}
        >
          {renderInline(text, theme)}
        </h2>
      );
      i++;
      continue;
    }

    // horizontal rule
    if (line === "---" || line === "***") {
      blocks.push(
        <hr
          key={`hr-${key++}`}
          style={{
            margin: "18px 0",
            border: 0,
            borderTop: `1px solid ${theme.quoteBorder}`,
          }}
        />
      );
      i++;
      continue;
    }

    // unordered list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith("- ") || lines[i].trim().startsWith("* "))
      ) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul
          key={`ul-${key++}`}
          style={{ margin: "8px 0", paddingLeft: 22 }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 4, lineHeight: 1.5 }}>
              {renderInline(it, theme)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ordered list (matches "1. ", "2.", "10.", etc.)
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={`ol-${key++}`}
          style={{ margin: "8px 0", paddingLeft: 22 }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 4, lineHeight: 1.5 }}>
              {renderInline(it, theme)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={`q-${key++}`}
          style={{
            margin: "10px 0",
            padding: "6px 12px",
            borderLeft: `3px solid ${theme.quoteBorder}`,
            color: "var(--muted, #8b93a7)",
            fontStyle: "italic",
          }}
        >
          {renderInline(quoteLines.join(" "), theme)}
        </blockquote>
      );
      continue;
    }

    // paragraph: consume until blank line / block element
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("## ") &&
      !lines[i].trim().startsWith("### ") &&
      !lines[i].trim().startsWith("# ") &&
      !lines[i].trim().startsWith("- ") &&
      !lines[i].trim().startsWith("* ") &&
      !/^\d+\.\s/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("```") &&
      lines[i].trim() !== "---" &&
      lines[i].trim() !== "***"
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p
        key={`p-${key++}`}
        style={{ margin: "8px 0", lineHeight: 1.55 }}
      >
        {renderInline(paraLines.join(" "), theme)}
      </p>
    );
  }
  return <>{blocks}</>;
}

export { slugify };
