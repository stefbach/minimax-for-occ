"use client";

import { useEffect, useState } from "react";
import { resolveHelp, type HelpRole } from "@/lib/help/registry";

type MeResponse = {
  user: { id: string; email: string | null } | null;
  current_role: HelpRole | null;
};

/**
 * Minimal markdown renderer. Supports a tiny subset that matches what we
 * author in `lib/help/registry.ts`:
 *   ## Heading
 *   - bullet (consecutive lines grouped)
 *   **bold**  *italic*  [text](url)
 *   blank line = paragraph break
 *
 * Returns a fragment of JSX nodes.
 */
function renderInline(text: string): React.ReactNode[] {
  // Order matters: links first (they contain []()), then bold, then italic.
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Combined regex with alternation; we walk and split.
  const re =
    /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/;

  while (remaining.length > 0) {
    const match = re.exec(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }
    if (match.index > 0) {
      nodes.push(remaining.slice(0, match.index));
    }
    if (match[1]) {
      // link
      nodes.push(
        <a
          key={`l-${key++}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent-2, #6aa0ff)" }}
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      nodes.push(<strong key={`b-${key++}`}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={`i-${key++}`}>{match[7]}</em>);
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return nodes;
}

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h3 key={`h-${key++}`} style={{ margin: "16px 0 8px", fontSize: 16 }}>
          {renderInline(trimmed.slice(3))}
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={`ul-${key++}`} style={{ margin: "8px 0", paddingLeft: 20 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>
              {renderInline(it)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // paragraph: consume until blank line
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("## ") &&
      !lines[i].trim().startsWith("- ")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p-${key++}`} style={{ margin: "8px 0", lineHeight: 1.5 }}>
        {renderInline(paraLines.join(" "))}
      </p>
    );
  }
  return <>{blocks}</>;
}

export function HelpDrawer({
  contextKey,
  onClose,
}: {
  contextKey: string;
  onClose: () => void;
}) {
  const [role, setRole] = useState<HelpRole | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MeResponse | null) => {
        if (cancelled) return;
        setRole((data?.current_role ?? null) as HelpRole | null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Prevent background scroll on mobile while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const resolved = loaded ? resolveHelp(contextKey, role) : null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 999,
        }}
      />
      <aside
        role="dialog"
        aria-label="Aide contextuelle"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          background: "var(--bg, #0f1115)",
          borderLeft: "1px solid var(--border, #2a2f3a)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.3)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border, #2a2f3a)",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "var(--muted, #8b93a7)" }}>
              Aide contextuelle
            </div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {resolved?.title ?? "Aide"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: "transparent",
              border: "1px solid var(--border, #2a2f3a)",
              borderRadius: 6,
              width: 32,
              height: 32,
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            padding: "8px 20px 24px",
            overflowY: "auto",
            flex: 1,
            fontSize: 14,
          }}
        >
          {!loaded && (
            <p style={{ color: "var(--muted, #8b93a7)" }}>Chargement…</p>
          )}
          {loaded && !resolved && (
            <p style={{ color: "var(--muted, #8b93a7)" }}>
              Aucune aide n&apos;est encore disponible pour cette page.
            </p>
          )}
          {loaded && resolved && (
            <>
              {renderMarkdown(resolved.body)}
              {resolved.learnMoreHref && (
                <p style={{ marginTop: 20 }}>
                  <a
                    href={resolved.learnMoreHref}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      padding: "8px 14px",
                      border: "1px solid var(--border, #2a2f3a)",
                      borderRadius: 6,
                      color: "var(--accent-2, #6aa0ff)",
                      textDecoration: "none",
                      fontSize: 13,
                    }}
                  >
                    En savoir plus →
                  </a>
                </p>
              )}
              {role && (
                <p
                  style={{
                    marginTop: 16,
                    fontSize: 11,
                    color: "var(--muted, #8b93a7)",
                  }}
                >
                  Vue adaptée à votre rôle : <strong>{role}</strong>
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
