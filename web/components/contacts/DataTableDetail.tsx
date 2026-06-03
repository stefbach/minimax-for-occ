"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ColumnSpec {
  key: string;
  label: string;
  type: string;
}

interface Props {
  registryId: string;
  physicalTable: string;
  columns: ColumnSpec[];
  phoneColumn: string;
  initialRows: Record<string, unknown>[];
}

export function DataTableDetail({ registryId, columns, phoneColumn, initialRows }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Columns to render: phone first, then declared columns (deduped).
  const displayCols: ColumnSpec[] = [
    { key: phoneColumn, label: "Téléphone", type: "phone" },
    ...columns.filter((c) => c.key !== phoneColumn),
  ];

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "boolean") return v ? "oui" : "non";
    return String(v);
  }

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return JSON.stringify(r).toLowerCase().includes(q);
  });

  async function addRow(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!draft[phoneColumn]?.trim()) {
      setError("Le téléphone est requis.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/data-tables/${registryId}/rows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: draft }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? `Échec (${r.status})`); return; }
      setRows((prev) => [body, ...prev]);
      setDraft({});
      setShowAdd(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function inputType(t: string): string {
    if (t === "number") return "number";
    if (t === "date") return "date";
    if (t === "datetime") return "datetime-local";
    if (t === "email") return "email";
    if (t === "phone") return "tel";
    return "text";
  }

  return (
    <>
      <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          style={{ flex: "1 1 240px", minWidth: 200 }}
        />
        <button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Annuler" : "+ Ajouter un contact"}</button>
      </div>

      {showAdd && (
        <form className="card" onSubmit={addRow} style={{ display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Nouveau contact</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {displayCols.map((c) => (
              <div key={c.key}>
                <label style={{ fontSize: 12 }}>
                  {c.label}
                  {c.key === phoneColumn && <span style={{ color: "var(--accent)" }}> *</span>}
                </label>
                <input
                  type={inputType(c.type)}
                  value={draft[c.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                  placeholder={c.key === phoneColumn ? "+44..." : ""}
                />
              </div>
            ))}
          </div>
          {error && <div style={{ color: "#ff8080" }}>{error}</div>}
          <div>
            <button type="submit" disabled={busy}>{busy ? "Ajout…" : "Ajouter"}</button>
          </div>
        </form>
      )}

      {error && !showAdd && (
        <div className="card" style={{ color: "#ff8080" }}>{error}</div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <h3>Table vide</h3>
          <p className="muted">
            Ajoutez des contacts un par un avec « + Ajouter un contact », ou importez un CSV
            depuis Supabase. Pour tester, mettez 2-3 numéros que vous pouvez appeler vous-même.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                {displayCols.map((c) => (
                  <th key={c.key} style={{ whiteSpace: "nowrap" }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={(r.id as string) ?? i}>
                  {displayCols.map((c) => (
                    <td key={c.key} style={{ fontSize: 13, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fmt(r[c.key]) || <em style={{ color: "var(--muted)" }}>—</em>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
