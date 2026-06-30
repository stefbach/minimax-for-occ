"use client";

import { renderMarkdown } from "@/lib/help/markdown";
import { useT } from "@/lib/i18n";

export type PersonaPreviewData = {
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
  body: string;
};

/**
 * Renders the markdown body of a persona using the shared help markdown
 * renderer, prefixed by a small metadata bar.
 */
export function PersonaPreview({ persona }: { persona: PersonaPreviewData }) {
  const t = useT();
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          padding: "8px 0 14px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 14,
        }}
      >
        <span className="tag">{persona.industry}</span>
        <span className="tag">{persona.language}</span>
        {persona.llm_model && <span className="tag">{persona.llm_model}</span>}
        {persona.voice_suggestion && (
          <span className="tag">voice: {persona.voice_suggestion}</span>
        )}
        {persona.max_call_duration_secs && (
          <span className="tag">max {persona.max_call_duration_secs}s</span>
        )}
        {persona.tags.map((t_) => (
          <span key={t_} className="tag" style={{ opacity: 0.8 }}>
            #{t_}
          </span>
        ))}
      </div>

      {persona.n8n_bindings_suggested.length > 0 && (
        <div style={{ marginBottom: 14, fontSize: 13 }}>
          <strong>{t("n8n bindings suggérés :")} </strong>
          {persona.n8n_bindings_suggested.map((b, i) => (
            <span key={b}>
              <span className="kbd">{b}</span>
              {i < persona.n8n_bindings_suggested.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      )}

      {persona.handoff_team_suggested && (
        <div style={{ marginBottom: 14, fontSize: 13 }}>
          <strong>{t("Handoff team suggérée :")} </strong>
          <span className="kbd">{persona.handoff_team_suggested}</span>
        </div>
      )}

      <div style={{ fontSize: 14, lineHeight: 1.55 }}>
        {renderMarkdown(persona.body)}
      </div>
    </div>
  );
}
