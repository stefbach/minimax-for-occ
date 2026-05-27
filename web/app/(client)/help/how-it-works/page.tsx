import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";
import { renderMarkdown } from "@/lib/help/markdown";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata = {
  title: "Comment ça marche — Axon",
  description:
    "Guide pédagogique : sous le capot d'Axon — pipeline voix, LLM, personas, swarm, coûts.",
};

/**
 * Locate HOW_IT_WORKS.md the same way /help loads USER_GUIDE.md.
 * We try a few candidates so this works both locally and on the
 * Vercel build (where `process.cwd()` is the package root).
 */
async function loadHowItWorks(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "../docs/HOW_IT_WORKS.md"),
    path.resolve(process.cwd(), "docs/HOW_IT_WORKS.md"),
    process.env.AXON_HOW_IT_WORKS_PATH || "",
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

/**
 * Pull the H2 headings ("## ...") out of the doc to build a small
 * sticky table of contents on the left.
 */
function extractToc(md: string): { id: string; title: string }[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: { id: string; title: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      const title = line.slice(3);
      const id = title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      out.push({ id, title });
    }
  }
  return out;
}

export default async function HowItWorksPage() {
  const md = await loadHowItWorks();
  const toc = md ? extractToc(md) : [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)",
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
          Sommaire
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
        <div
          style={{
            marginLeft: 8,
            borderLeft: "1px solid var(--border, #2a2f3a)",
            paddingLeft: 8,
            marginTop: 4,
          }}
        >
          {toc.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                display: "block",
                padding: "4px 8px",
                color: "var(--muted, #8b93a7)",
                textDecoration: "none",
                borderRadius: 4,
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {s.title}
            </a>
          ))}
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid var(--border, #2a2f3a)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Link
            href="/help"
            style={{
              display: "block",
              padding: "6px 8px",
              color: "var(--accent-2, #6aa0ff)",
              textDecoration: "none",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            ← Guide d&apos;utilisation
          </Link>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <article style={{ minWidth: 0 }}>
        <section id="top" style={{ scrollMarginTop: 16 }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Link
              href="/help"
              style={{
                fontSize: 12,
                color: "var(--muted, #8b93a7)",
                textDecoration: "none",
              }}
            >
              Aide
            </Link>
            <span style={{ color: "var(--muted-2, #8b93a7)", fontSize: 12 }}>
              ›
            </span>
            <span style={{ fontSize: 12, color: "var(--muted, #8b93a7)" }}>
              Comment ça marche
            </span>
          </div>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
            Comment ça marche
          </h1>
          <p
            style={{
              margin: "0 0 24px",
              color: "var(--muted, #8b93a7)",
              fontSize: 15,
              lineHeight: 1.6,
            }}
          >
            Sous le capot d&apos;Axon : ce qui se passe entre le moment où un
            client compose ton numéro et le moment où l&apos;agent IA répond.
            LLM, STT, TTS, personas, swarm, coûts, FAQ.
          </p>
        </section>

        {md && (
          <section style={{ fontSize: 14 }}>
            {renderMarkdown(md, { headingIds: true })}
          </section>
        )}

        {!md && (
          <section
            style={{
              marginTop: 24,
              padding: 16,
              border: "1px dashed var(--border, #2a2f3a)",
              borderRadius: 8,
              color: "var(--muted, #8b93a7)",
              fontSize: 13,
            }}
          >
            Le guide pédagogique (<code>docs/HOW_IT_WORKS.md</code>) n&apos;a
            pas pu être chargé sur cet environnement. Vérifie que le fichier
            est bien présent à la racine du repo.
          </section>
        )}
      </article>
    </div>
  );
}
