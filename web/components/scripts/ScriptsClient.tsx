"use client";

import { useCallback, useEffect, useState } from "react";
import { ScriptEditor, type ScriptStep } from "./ScriptEditor";

type ScriptRow = {
  id: string;
  org_id: string;
  name: string;
  mission: string | null;
  description: string | null;
  created_at: string;
  latest_version: number | null;
  latest_version_at: string | null;
};

type ScriptDetail = ScriptRow & {
  latest_version: {
    id: string;
    version: number;
    steps: ScriptStep[];
    note: string | null;
    created_at: string;
    created_by: string | null;
  } | null;
};

const MISSIONS = ["qualification", "closing", "rappel", "sav", "autre"];

export function ScriptsClient() {
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state.
  const [name, setName] = useState("");
  const [mission, setMission] = useState("qualification");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/scripts");
      if (!r.ok) throw new Error("fetch scripts failed");
      setScripts((await r.json()) as ScriptRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mission,
          description: description.trim() || null,
          steps: [],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "create failed");
      setName("");
      setDescription("");
      await refresh();
      setSelectedId(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [name, mission, description, refresh]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Supprimer ce script ?")) return;
      const r = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "delete failed");
        return;
      }
      if (selectedId === id) setSelectedId(null);
      await refresh();
    },
    [refresh, selectedId],
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="card">
        <h3>Nouveau script</h3>
        <div style={{ display: "grid", gap: 8 }}>
          <label className="muted" style={{ fontSize: 12 }}>Nom</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Qualification SaaS B2B"
          />
          <label className="muted" style={{ fontSize: 12 }}>Mission</label>
          <select value={mission} onChange={(e) => setMission(e.target.value)}>
            {MISSIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <label className="muted" style={{ fontSize: 12 }}>Description</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="À quoi sert ce script ?"
          />
          <div>
            <button onClick={create} disabled={creating || !name.trim()}>
              {creating ? "Création…" : "Créer le script"}
            </button>
          </div>
          {error && (
            <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>
          )}
        </div>

        <h3 style={{ marginTop: 24 }}>Scripts existants</h3>
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : scripts.length === 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              Aucun script pour le moment.
            </p>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Un script définit la trame conversationnelle pour vos agents
              (qualification, closing, SAV…). Remplissez le formulaire ci-dessus
              pour créer votre premier script.
            </div>
            <div>
              <button
                onClick={() => {
                  const el = document.querySelector<HTMLInputElement>(
                    "input[placeholder^=\"Ex: Qualification\"]",
                  );
                  el?.focus();
                }}
              >
                + Créer un script
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scripts.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedId(s.id);
                }}
                style={{
                  textAlign: "left",
                  border: "1px solid",
                  borderColor:
                    s.id === selectedId ? "var(--accent)" : "var(--border-2)",
                  background:
                    s.id === selectedId ? "var(--accent-soft)" : "transparent",
                  padding: "10px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>{s.name}</strong>
                  <span className="tag" style={{ fontSize: 10 }}>
                    {s.mission ?? "—"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  v{s.latest_version ?? "?"} ·{" "}
                  {s.description ?? "Sans description"}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(s.id);
                    }}
                    style={{
                      fontSize: 11,
                      color: "var(--bad)",
                      padding: "2px 8px",
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {selectedId ? (
          <ScriptDetailView id={selectedId} onSaved={() => void refresh()} />
        ) : (
          <>
            <h3>Éditer un script</h3>
            <p className="muted">
              Sélectionnez un script à gauche pour modifier ses étapes.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ScriptDetailView({
  id,
  onSaved,
}: {
  id: string;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [steps, setSteps] = useState<ScriptStep[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/scripts/${id}`);
      const data = (await r.json()) as ScriptDetail;
      if (!r.ok) {
        throw new Error(
          (data as unknown as { error: string }).error ?? "load failed",
        );
      }
      setDetail(data);
      setSteps(data.latest_version?.steps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveVersion = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/scripts/${id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps, note: note || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "save failed");
      setNote("");
      onSaved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [id, steps, note, load, onSaved]);

  if (loading) return <p className="muted">Chargement…</p>;
  if (!detail) return <p className="muted">Script introuvable.</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{detail.name}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {detail.mission ?? "—"} · v
            {detail.latest_version?.version ?? "?"}
          </div>
        </div>
      </div>
      {detail.description && (
        <p className="muted" style={{ fontSize: 13 }}>{detail.description}</p>
      )}

      <div style={{ marginTop: 12 }}>
        <ScriptEditor value={steps} onChange={setSteps} />
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <label className="muted" style={{ fontSize: 12 }}>
          Note de version (facultatif)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex: ajout objection prix"
        />
        <div>
          <button onClick={saveVersion} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer comme nouvelle version"}
          </button>
        </div>
        {error && (
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>
        )}
      </div>
    </div>
  );
}
