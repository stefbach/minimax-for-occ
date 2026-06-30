"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

interface TemplateOption {
  slug: string;
  name: string;
  description: string;
}

export function CreateWorkflowForm({ templates }: { templates: TemplateOption[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(templates[0]?.slug ?? "");
  const [slug, setSlug] = useState("my-workflow");
  const [activate, setActivate] = useState(true);
  const [created, setCreated] = useState<{ id: string; name: string; editor_url: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/n8n/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: picked, slug, activate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      setCreated({
        id: data.workflow.id,
        name: data.workflow.name,
        editor_url: data.editor_url,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="card" style={{ display: "grid", gap: 14 }}>
        <h3 style={{ margin: 0 }}>✓ {t("Workflow créé")}</h3>
        <p className="muted" style={{ margin: 0 }}>
          <strong>{created.name}</strong> ({created.id})
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href={created.editor_url} target="_blank" rel="noopener noreferrer">
            <button>{t("Ouvrir dans l'éditeur n8n")} ↗</button>
          </a>
          <button className="ghost" onClick={() => router.push("/workflows")}>
            {t("Retour à la liste")}
          </button>
          <button
            className="ghost"
            onClick={() => {
              setCreated(null);
              setSlug("my-workflow");
            }}
          >
            + {t("En créer un autre")}
          </button>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {t("Pour le brancher à un agent : ouvrez l'agent → onglet « Workflows n8n » → bouton")}{" "}
          <strong>↻ {t("Rafraîchir")}</strong> {t("→ le nouveau workflow apparaît dans la section")}{" "}
          {t("« disponibles », cliquez sur son chemin de webhook pour le binder.")}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>1. {t("Template")}</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {templates.map((tmpl) => (
            <label
              key={tmpl.slug}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: 12,
                border: `1px solid ${picked === tmpl.slug ? "var(--accent)" : "var(--border)"}`,
                background: picked === tmpl.slug ? "var(--accent-soft)" : "var(--panel-2)",
                borderRadius: 10,
                cursor: "pointer",
                marginBottom: 0,
              }}
            >
              <input
                type="radio"
                name="template"
                value={tmpl.slug}
                checked={picked === tmpl.slug}
                onChange={() => setPicked(tmpl.slug)}
                style={{ width: 18, marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>{tmpl.name}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{tmpl.description}</div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted-2)" }}>
                  webhook: <span className="kbd">/webhook/voice-agent/&lt;slug&gt;</span>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>2. {t("Identifiant")}</h3>
        <div className="form-row">
          <div>
            <label>{t("Slug (devient le nom et le path du webhook)")}</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="book-appointment-tibok"
              required
              pattern="[a-z0-9][a-z0-9-]{2,40}"
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {t("3 à 40 caractères, minuscules, chiffres ou tirets.")}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={activate}
              onChange={(e) => setActivate(e.target.checked)}
              style={{ width: 18 }}
            />
            {t("Activer immédiatement")}
          </label>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>}

      <div>
        <button type="submit" disabled={busy || !picked || !slug}>
          {busy ? t("Création…") : t("Créer le workflow")}
        </button>
      </div>
    </form>
  );
}
