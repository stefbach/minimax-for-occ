"use client";

import { useEffect, useState } from "react";
import type { RagDocument } from "@/lib/types";

export function AgentDocuments({ agentId }: { agentId: string }) {
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/documents`);
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, [agentId]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || !source.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agents/${agentId}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_name: source, content }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "upload failed");
      return;
    }
    setSource("");
    setContent("");
    refresh();
  }

  async function onUploadFile(file: File) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const res = await fetch(`/api/agents/${agentId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_name: file.name, content: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "upload failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function delChunk(id: string) {
    if (!confirm("Supprimer ce fragment ?")) return;
    await fetch(`/api/agents/${agentId}/documents?doc_id=${id}`, { method: "DELETE" });
    refresh();
  }

  async function delSource(name: string) {
    if (!confirm(`Supprimer toutes les chunks de "${name}" ?`)) return;
    await fetch(`/api/agents/${agentId}/documents?source=${encodeURIComponent(name)}`, { method: "DELETE" });
    refresh();
  }

  // group by source for cleaner display
  const grouped = docs.reduce<Record<string, RagDocument[]>>((acc, d) => {
    (acc[d.source_name] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Ajouter du contenu</h3>
        <form onSubmit={onUpload} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>Nom de la source</label>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="faq-tibok.txt" />
            </div>
            <div>
              <label>Ou importer un fichier .txt / .md</label>
              <input
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                onChange={(e) => e.target.files?.[0] && onUploadFile(e.target.files[0])}
                disabled={busy}
              />
            </div>
          </div>
          <div>
            <label>Contenu (texte brut, sera découpé et embeddé)</label>
            <textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <div>
            <button type="submit" disabled={busy || !content.trim() || !source.trim()}>
              {busy ? "Embedding…" : "Indexer"}
            </button>
          </div>
        </form>
        {error && <div style={{ color: "var(--bad)", marginTop: 8 }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 16 }}>
          <h3 style={{ margin: 0 }}>Corpus indexé ({docs.length} fragment{docs.length === 1 ? "" : "s"})</h3>
        </div>
        {Object.keys(grouped).length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
            Aucun document. Ajoutez du texte ci-dessus.
          </div>
        ) : (
          <table className="list">
            <thead><tr><th>Source</th><th>Fragments</th><th>Aperçu</th><th></th></tr></thead>
            <tbody>
              {Object.entries(grouped).map(([name, chunks]) => (
                <tr key={name}>
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td>{chunks.length}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {chunks[0].content.slice(0, 140)}…
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="danger" style={{ padding: "5px 9px" }} onClick={() => delSource(name)}>
                      Supprimer
                    </button>
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
