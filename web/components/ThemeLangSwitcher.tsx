"use client";

import { useEffect, useState } from "react";

// Lightweight theme + language switcher. Persists to localStorage and applies
// `data-theme` / `data-lang` on <html> so any CSS or hook can react.
//
// Theme: 'dark' (default) | 'light'. Language: 'fr' (default) | 'en'.
// Language is wired (stored + applied) so the value is available everywhere;
// progressive UI translation is layered on top per page.

export type Theme = "dark" | "light";
export type Lang = "fr" | "en";

const THEME_KEY = "axon.theme";
const LANG_KEY = "axon.lang";

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
}
function applyLang(l: Lang) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-lang", l);
  document.documentElement.setAttribute("lang", l);
}

export function ThemeLangSwitcher() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [lang, setLang] = useState<Lang>("fr");
  const [hydrated, setHydrated] = useState(false);

  // Read saved prefs after mount (SSR-safe).
  useEffect(() => {
    try {
      const t = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark";
      const l = (localStorage.getItem(LANG_KEY) as Lang | null) ?? "fr";
      setTheme(t === "light" ? "light" : "dark");
      setLang(l === "en" ? "en" : "fr");
      applyTheme(t === "light" ? "light" : "dark");
      applyLang(l === "en" ? "en" : "fr");
    } catch {
      /* localStorage unavailable */
    }
    setHydrated(true);
  }, []);

  const updateTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  };
  const updateLang = (l: Lang) => {
    setLang(l);
    applyLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
    // Tell any subscriber the language changed so they can re-render labels.
    try {
      window.dispatchEvent(new CustomEvent("axon:lang", { detail: l }));
    } catch {
      /* ignore */
    }
  };

  // Avoid flicker between SSR default (dark/fr) and user pref.
  const visibility = hydrated ? 1 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", opacity: visibility, transition: "opacity 80ms" }}>
      <div style={pill}>
        <SegButton active={theme === "dark"} onClick={() => updateTheme("dark")} title="Sombre" ariaLabel="Theme: dark">
          ☾
        </SegButton>
        <SegButton active={theme === "light"} onClick={() => updateTheme("light")} title="Clair" ariaLabel="Theme: light">
          ☀
        </SegButton>
      </div>
      <div style={pill}>
        <SegButton active={lang === "fr"} onClick={() => updateLang("fr")} title="Français" ariaLabel="Language: French">
          FR
        </SegButton>
        <SegButton active={lang === "en"} onClick={() => updateLang("en")} title="English" ariaLabel="Language: English">
          EN
        </SegButton>
      </div>
    </div>
  );
}

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 2,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-2)",
};

function SegButton({
  active,
  onClick,
  children,
  title,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      style={{
        height: 24,
        minWidth: 28,
        padding: "0 8px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#0a0a0a" : "var(--muted)",
        border: 0,
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** Read the active language without mounting a hook (server-safe falls back to 'fr'). */
export function getLang(): Lang {
  if (typeof window === "undefined") return "fr";
  const v = localStorage.getItem(LANG_KEY);
  return v === "en" ? "en" : "fr";
}
