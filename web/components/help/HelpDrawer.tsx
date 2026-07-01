"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { resolveHelp, type HelpRole } from "@/lib/help/registry";
import { renderMarkdown } from "@/lib/help/markdown";

type MeResponse = {
  user: { id: string; email: string | null } | null;
  current_role: HelpRole | null;
};

export function HelpDrawer({
  contextKey,
  onClose,
}: {
  contextKey: string;
  onClose: () => void;
}) {
  const t = useT();
  const [role, setRole] = useState<HelpRole | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<"fr" | "en">("en");

  // Detect the interface language from localStorage (set by ThemeLangSwitcher).
  useEffect(() => {
    try {
      const stored = localStorage.getItem("axon.lang");
      if (stored === "fr" || stored === "en") setLang(stored);
    } catch {
      // localStorage unavailable (SSR / private mode) — keep default "en"
    }
    const onLang = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "fr" || detail === "en") setLang(detail);
    };
    window.addEventListener("axon:lang", onLang);
    return () => window.removeEventListener("axon:lang", onLang);
  }, []);

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

  const resolved = loaded ? resolveHelp(contextKey, role, lang) : null;
  const fullGuideHref = `/help#${contextKey}`;

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
          width: "min(460px, 100vw)",
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
              {t("Aide contextuelle")}
            </div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {resolved?.title ?? t("Aide")}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t("Fermer")}
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
            <p style={{ color: "var(--muted, #8b93a7)" }}>{t("Chargement…")}</p>
          )}
          {loaded && !resolved && (
            <p style={{ color: "var(--muted, #8b93a7)" }}>
              Aucune aide n&apos;est encore disponible pour cette page.
            </p>
          )}
          {loaded && resolved && <>{renderMarkdown(resolved.body)}</>}
        </div>

        {loaded && resolved && (
          <footer
            style={{
              padding: "12px 20px 16px",
              borderTop: "1px solid var(--border, #2a2f3a)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <a
              href={fullGuideHref}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 14px",
                border: "1px solid var(--border, #2a2f3a)",
                borderRadius: 6,
                color: "var(--accent-2, #6aa0ff)",
                textDecoration: "none",
                fontSize: 13,
                background: "transparent",
              }}
            >
              📖 {t("Ouvrir le guide complet")}
            </a>
            <a
              href="/help/how-it-works"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 14px",
                border: "1px solid var(--border, #2a2f3a)",
                borderRadius: 6,
                color: "var(--accent-2, #6aa0ff)",
                textDecoration: "none",
                fontSize: 13,
                background: "transparent",
              }}
            >
              🛠️ {t("Comment ça marche ?")}
            </a>
            {role && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "var(--muted, #8b93a7)",
                  textAlign: "center",
                }}
              >
                {t("Vue adaptée à votre rôle")} : <strong>{role}</strong>
              </p>
            )}
          </footer>
        )}
      </aside>
    </>
  );
}
