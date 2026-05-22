"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpButton } from "@/components/help/HelpButton";
import { useToast } from "@/lib/use-toast";

type Policy = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  prompt: string;
  output_schema: Record<string, unknown>;
  scope: "all" | "campaign" | "queue" | string;
  scope_id: string | null;
  enabled: boolean;
  model: string | null;
  created_at: string;
};

const DEFAULT_SCHEMA = {
  sentiment: "number (-1..1)",
  interest_level: "string (low | medium | high)",
  topics: "array of strings",
  summary: "string",
};

function emptyPolicy(): Partial<Policy> {
  return {
    name: "",
    description: "",
    prompt:
      "Analyse cet appel et renvoie un JSON conforme au schéma. Donne un score de sentiment, le niveau d'intérêt, les sujets abordés et un résumé d'une phrase.",
    output_schema: DEFAULT_SCHEMA,
    scope: "all",
    scope_id: null,
    enabled: true,
    model: "deepseek-chat",
  };
}

export function AnalysesClient() {
  const toast = useToast();
  const [list, setList] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Policy> | null>(null);
  const [schemaText, setSchemaText] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/analysis-policies", { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as Policy[];
      setList(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startNew = useCallback(() => {
    const p = emptyPolicy();
    setEditing(p);
    setSchemaText(JSON.stringify(p.output_schema, null, 2));
  }, []);

  const startEdit = useCallback((p: Policy) => {
    setEditing({ ...p });
    setSchemaText(JSON.stringify(p.output_schema, null, 2));
  }, []);

  const cancel = useCallback(() => {
    setEditing(null);
    setSchemaText("");
  }, []);

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      let parsedSchema: unknown;
      try {
        parsedSchema = JSON.parse(schemaText);
      } catch {
        throw new Error("output_schema doit être un JSON valide");
      }
      const payload = { ...editing, output_schema: parsedSchema };
      const isNew = !editing.id;
      const url = isNew ? "/api/analysis-policies" : `/api/analysis-policies/${editing.id}`;
      const r = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      await refresh();
      setEditing(null);
      toast.success("Policy enregistrée.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Enregistrement échoué : ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [editing, schemaText, refresh, toast]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Supprimer cette policy ?")) return;
      try {
        const r = await fetch(`/api/analysis-policies/${id}`, { method: "DELETE" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  const sorted = useMemo(
    () => [...list].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [list],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analyses LLM</h1>
          <div className="subtitle">
            Définissez des analyses post-appel : prompt + schéma JSON attendu. Chaque
            appel terminé déclenchera les policies actives.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={startNew}>+ Nouvelle policy</button>
          <HelpButton contextKey="analyses" />
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>
        </div>
      )}

      {editing && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>{editing.id ? "Modifier la policy" : "Nouvelle policy"}</h3>
          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Nom</div>
              <input
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Détection intérêt achat"
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Description</div>
              <input
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Prompt LLM</div>
              <textarea
                value={editing.prompt ?? ""}
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                rows={5}
                style={{ width: "100%", fontFamily: "inherit" }}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>
                Schéma de sortie (JSON)
              </div>
              <textarea
                value={schemaText}
                onChange={(e) => setSchemaText(e.target.value)}
                rows={8}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Scope</div>
                <select
                  value={editing.scope ?? "all"}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      scope: e.target.value,
                      scope_id: e.target.value === "all" ? null : editing.scope_id ?? null,
                    })
                  }
                  style={{ width: "100%" }}
                >
                  <option value="all">all</option>
                  <option value="campaign">campaign</option>
                  <option value="queue">queue</option>
                </select>
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Scope ID (uuid)</div>
                <input
                  value={editing.scope_id ?? ""}
                  onChange={(e) => setEditing({ ...editing, scope_id: e.target.value || null })}
                  disabled={editing.scope === "all"}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Modèle</div>
                <input
                  value={editing.model ?? ""}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder="deepseek-chat"
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={editing.enabled ?? true}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              />
              <span>Active</span>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button className="ghost" onClick={cancel} disabled={saving}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : sorted.length === 0 ? (
          <div style={{ display: "grid", gap: 12, padding: "8px 2px" }}>
            <p className="muted" style={{ margin: 0 }}>
              Aucune policy pour l&apos;instant.
            </p>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 560 }}>
              Une policy associe un <em>prompt LLM</em> à un <em>schéma JSON</em> :
              à chaque appel terminé, le LLM remplit le schéma. Les valeurs servent
              ensuite aux alertes, à l&apos;analytics et au scoring.
            </div>
            <div>
              <button onClick={startNew}>+ Créer une politique</button>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Scope</th>
                <th>Modèle</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.description && (
                      <div className="muted" style={{ fontSize: 12 }}>{p.description}</div>
                    )}
                  </td>
                  <td>
                    <span className="tag">{p.scope}</span>
                    {p.scope_id && (
                      <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                        {p.scope_id.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td><span className="kbd">{p.model ?? "deepseek-chat"}</span></td>
                  <td>
                    <span className={p.enabled ? "tag good" : "tag"}>
                      {p.enabled ? "Oui" : "Non"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="ghost" onClick={() => startEdit(p)}>
                        Modifier
                      </button>
                      <button className="danger" onClick={() => remove(p.id)}>
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
