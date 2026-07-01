import { promises as fs } from "fs";
import path from "path";
import { HELP, allContextKeys, type HelpRole } from "@/lib/help/registry";
import { renderMarkdown } from "@/lib/help/markdown";
import { HelpPageScroller } from "@/components/help/HelpPageScroller";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata = {
  title: "User guide — Axon",
  description:
    "Full documentation and user guide for the Axon platform.",
};

/**
 * Locate USER_GUIDE.md. In dev we have the repo root two levels up from
 * `web/`. We try a few candidates so this works both locally and on the
 * Vercel build (where `process.cwd()` is the package root).
 */
async function loadUserGuide(): Promise<string | null> {
  const candidates = [
    // running from web/ (most cases)
    path.resolve(process.cwd(), "../docs/USER_GUIDE.md"),
    // running from repo root
    path.resolve(process.cwd(), "docs/USER_GUIDE.md"),
    // explicit env override for unusual deployments
    process.env.AXON_USER_GUIDE_PATH || "",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, "utf-8");
      if (txt && txt.length > 0) return txt;
    } catch {
      // try next
    }
  }
  return null;
}

type Section = {
  key: string;
  title: string;
  body: string;
};

function sectionsFromRegistry(role: HelpRole | null): Section[] {
  return allContextKeys().map((key) => {
    const entry = HELP[key];
    const body = (role && entry[role]) || entry.default;
    return { key, title: entry.title, body };
  });
}

export default async function HelpPage() {
  const guide = await loadUserGuide();
  const sections = sectionsFromRegistry(null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 240px) minmax(0, 1fr)",
        gap: 32,
        padding: "24px 32px",
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      {/* ── Table of contents (sticky) ───────────────────────────────── */}
      <aside
        style={{
          position: "sticky",
          top: 16,
          alignSelf: "start",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          padding: "12px 8px",
          borderRight: "1px solid var(--border, #2a2f3a)",
          fontSize: 13,
        }}
      >
        <div
          style={{
            textTransform: "uppercase",
            letterSpacing: 1,
            fontSize: 10,
            color: "var(--muted-2, #8b93a7)",
            padding: "4px 8px 10px",
          }}
        >
          Contents
        </div>
        <a
          href="#top"
          style={{
            display: "block",
            padding: "6px 8px",
            color: "var(--fg, inherit)",
            textDecoration: "none",
            borderRadius: 4,
            opacity: 0.9,
          }}
        >
          Introduction
        </a>
        <a
          href="#registry"
          style={{
            display: "block",
            padding: "6px 8px",
            color: "var(--fg, inherit)",
            textDecoration: "none",
            borderRadius: 4,
            opacity: 0.9,
          }}
        >
          By app section
        </a>
        <div
          style={{
            marginLeft: 8,
            borderLeft: "1px solid var(--border, #2a2f3a)",
            paddingLeft: 8,
          }}
        >
          {sections.map((s) => (
            <a
              key={s.key}
              href={`#${s.key}`}
              style={{
                display: "block",
                padding: "4px 8px",
                color: "var(--muted, #8b93a7)",
                textDecoration: "none",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {s.title}
            </a>
          ))}
        </div>
        {guide && (
          <a
            href="#user-guide"
            style={{
              display: "block",
              padding: "6px 8px",
              marginTop: 8,
              color: "var(--fg, inherit)",
              textDecoration: "none",
              borderRadius: 4,
              opacity: 0.9,
            }}
          >
            Guide utilisateur complet
          </a>
        )}
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <article style={{ minWidth: 0 }}>
        <HelpPageScroller />
        <section id="top" style={{ scrollMarginTop: 16 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
            User guide
          </h1>
          <p
            style={{
              margin: "0 0 16px",
              color: "var(--muted, #8b93a7)",
              fontSize: 15,
            }}
          >
            Everything you need to know to use the platform day-to-day.
            Click a section in the contents to jump straight to it.
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            <a
              href="/help/how-it-works"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                border: "1px solid var(--border, #2a2f3a)",
                borderRadius: 6,
                color: "var(--accent-2, #6aa0ff)",
                textDecoration: "none",
                fontSize: 13,
                background: "rgba(106,160,255,0.06)",
              }}
            >
              How it works (under the hood) →
            </a>
          </div>
        </section>

        <section id="registry" style={{ scrollMarginTop: 16 }}>
          <h2
            style={{
              margin: "12px 0 16px",
              fontSize: 22,
              borderBottom: "1px solid var(--border, #2a2f3a)",
              paddingBottom: 8,
            }}
          >
            By app section
          </h2>
          <p style={{ color: "var(--muted, #8b93a7)", marginTop: 0 }}>
            A detailed view of each platform page — practical, educational,
            with use cases and pitfalls to avoid.
          </p>

          {sections.map((s) => (
            <section
              key={s.key}
              id={s.key}
              style={{
                marginTop: 28,
                paddingTop: 12,
                scrollMarginTop: 16,
                borderTop: "1px solid var(--border, #2a2f3a)",
              }}
            >
              <h2
                style={{
                  margin: "8px 0 4px",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span>{s.title}</span>
                <code
                  style={{
                    fontSize: 11,
                    color: "var(--muted-2, #8b93a7)",
                    background: "rgba(127,127,127,0.12)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontWeight: 400,
                  }}
                >
                  #{s.key}
                </code>
              </h2>
              <div style={{ fontSize: 14 }}>{renderMarkdown(s.body)}</div>
            </section>
          ))}
        </section>

        {guide && (
          <section
            id="user-guide"
            style={{
              marginTop: 48,
              paddingTop: 24,
              borderTop: "2px solid var(--border, #2a2f3a)",
              scrollMarginTop: 16,
            }}
          >
            <h2 style={{ fontSize: 22, margin: "0 0 16px" }}>
              Full user manual
            </h2>
            <p style={{ color: "var(--muted, #8b93a7)", marginTop: 0 }}>
              Below is the complete platform manual covering all workflows and concepts.
            </p>
            <div style={{ fontSize: 14 }}>
              {renderMarkdown(guide, { headingIds: true })}
            </div>
          </section>
        )}

        {!guide && (
          <section
            id="user-guide"
            style={{
              marginTop: 48,
              padding: 16,
              border: "1px dashed var(--border, #2a2f3a)",
              borderRadius: 8,
              color: "var(--muted, #8b93a7)",
              fontSize: 13,
            }}
          >
            The full manual (<code>docs/USER_GUIDE.md</code>) could not be
            loaded in this environment. The sections above are still available.
          </section>
        )}
      </article>
    </div>
  );
}
