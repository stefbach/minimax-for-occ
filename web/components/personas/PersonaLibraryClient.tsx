"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PersonaPreview, type PersonaPreviewData } from "./PersonaPreview";

type PersonaSummary = {
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
  description: string;
};

const LANGUAGE_FLAGS: Record<string, string> = {
  fr: "FR",
  en: "EN",
  es: "ES",
  de: "DE",
  it: "IT",
  multi: "MULTI",
};

export function PersonaLibraryClient({ initial }: { initial: PersonaSummary[] }) {
  const router = useRouter();
  const [personas] = useState<PersonaSummary[]>(initial);
  const [industry, setIndustry] = useState("");
  const [language, setLanguage] = useState("");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<PersonaPreviewData | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [cloneBusy, setCloneBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const industries = useMemo(
    () => Array.from(new Set(personas.map((p) => p.industry))).sort(),
    [personas]
  );
  const languages = useMemo(
    () => Array.from(new Set(personas.map((p) => p.language))).sort(),
    [personas]
  );

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return personas.filter((p) => {
      if (industry && p.industry !== industry) return false;
      if (language && p.language !== language) return false;
      if (qLower) {
        const hay = `${p.title} ${p.slug} ${p.description} ${p.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [personas, industry, language, q]);

  async function openPreview(slug: string) {
    setPreviewBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/personas/${slug}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = (await r.json()) as PersonaPreviewData;
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function clonePersona(slug: string) {
    setCloneBusy(slug);
    setError(null);
    try {
      const r = await fetch(`/api/personas/${slug}/clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `${r.status}`);
      }
      const agent = (await r.json()) as { id: string };
      router.push(`/agents/${agent.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloneBusy(null);
    }
  }

  return (
    <div>
      <div
        className="card"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 2fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div>
          <label>Industrie</label>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">— toutes —</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Langue</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">— toutes —</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_FLAGS[l] ?? l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Recherche</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ex: hotel, billing, prospection…"
          />
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{
            borderColor: "var(--bad)",
            color: "var(--bad)",
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>
        {filtered.length} persona{filtered.length === 1 ? "" : "s"} disponible
        {filtered.length === 1 ? "" : "s"}
        {personas.length === 0 ? " — vérifie que le dossier /personas est présent dans le déploiement." : ""}
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        }}
      >
        {filtered.map((p) => (
          <div key={p.slug} className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{p.title}</h3>
              <span className="tag">{LANGUAGE_FLAGS[p.language] ?? p.language.toUpperCase()}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <span className="tag" style={{ opacity: 0.85 }}>
                {p.industry}
              </span>
              {p.tags.slice(0, 3).map((t) => (
                <span key={t} className="tag" style={{ opacity: 0.7, fontSize: 10 }}>
                  #{t}
                </span>
              ))}
            </div>
            <div
              style={{
                color: "var(--muted)",
                fontSize: 12,
                lineHeight: 1.45,
                minHeight: 60,
              }}
            >
              {p.description}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <button
                type="button"
                className="ghost"
                onClick={() => openPreview(p.slug)}
                disabled={previewBusy}
                style={{ flex: 1 }}
              >
                Aperçu
              </button>
              <button
                type="button"
                onClick={() => clonePersona(p.slug)}
                disabled={cloneBusy === p.slug}
                style={{ flex: 1 }}
              >
                {cloneBusy === p.slug ? "Clonage…" : "Cloner dans mon org"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 1000,
            display: "flex",
            alignItems: "stretch",
            justifyContent: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: "min(720px, 96vw)",
              height: "100vh",
              overflowY: "auto",
              borderRadius: 0,
              padding: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 10,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>{preview.title}</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => clonePersona(preview.slug)}
                  disabled={cloneBusy === preview.slug}
                >
                  {cloneBusy === preview.slug ? "Clonage…" : "Cloner"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPreview(null)}
                >
                  Fermer
                </button>
              </div>
            </div>
            <PersonaPreview persona={preview} />
          </div>
        </div>
      )}
    </div>
  );
}
