"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

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

type ImportReport = {
  inserted: number;
  total: number;
  errors: { row: number; reason: string }[];
};

export function DataTableDetail({ registryId, columns, phoneColumn, initialRows }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Build a label → key map so users can fill the human-readable template
  // and we still know which DB column each cell targets.
  const keyByLabel: Record<string, string> = {};
  for (const c of columns) keyByLabel[c.label.toLowerCase()] = c.key;
  keyByLabel["téléphone"] = phoneColumn;
  keyByLabel["telephone"] = phoneColumn;
  keyByLabel["phone"] = phoneColumn;
  keyByLabel[phoneColumn.toLowerCase()] = phoneColumn;

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    setImportError(null);
    setImportReport(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Fichier vide.");
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (json.length === 0) throw new Error("Aucune ligne trouvée dans le fichier.");

      // Re-map labels → column keys. Skip the example row (any row whose
      // phone cell is the template placeholder).
      const mapped = json
        .map((row) => {
          const out: Record<string, unknown> = {};
          for (const [rawHeader, value] of Object.entries(row)) {
            const k = keyByLabel[rawHeader.toLowerCase().trim()] ?? rawHeader;
            if (value !== "" && value !== null && value !== undefined) out[k] = value;
          }
          return out;
        })
        .filter((r) => {
          const phone = String(r[phoneColumn] ?? "").trim();
          return phone && !phone.includes("XXXX");
        });

      if (mapped.length === 0) {
        throw new Error("Aucune ligne valide à importer (téléphone manquant ?).");
      }

      const r = await fetch(`/api/data-tables/${registryId}/rows/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: mapped }),
      });
      const body = await r.json();
      if (!r.ok) {
        setImportError(body.error ?? `Échec import (HTTP ${r.status})`);
        return;
      }
      setImportReport(body as ImportReport);
      router.refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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

  function openEdit(row: Record<string, unknown>) {
    const id = row.id as string;
    if (!id) return;
    const initial: Record<string, string> = {};
    for (const c of displayCols) {
      const v = row[c.key];
      initial[c.key] = v === null || v === undefined ? "" : String(v);
    }
    setEditDraft(initial);
    setEditingId(id);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const r = await fetch(`/api/data-tables/${registryId}/rows/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: editDraft }),
      });
      const body = await r.json();
      if (!r.ok) {
        setEditError(body.error ?? `Échec (${r.status})`);
        return;
      }
      setRows((prev) => prev.map((r) => ((r.id as string) === editingId ? body : r)));
      setEditingId(null);
      router.refresh();
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteRow(row: Record<string, unknown>) {
    const id = row.id as string;
    if (!id) return;
    const label = String(row[phoneColumn] ?? id);
    if (!confirm(`Supprimer ce contact (${label}) ? Cette action est irréversible.`)) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/data-tables/${registryId}/rows/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        alert((body as { error?: string }).error ?? `Échec suppression (${r.status})`);
        return;
      }
      setRows((prev) => prev.filter((r) => (r.id as string) !== id));
      router.refresh();
    } finally {
      setDeletingId(null);
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
        <button
          className="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy}
          title="Importer un fichier CSV ou Excel"
        >
          {importBusy ? "Import…" : "📥 Importer CSV/Excel"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleImport}
          style={{ display: "none" }}
        />
        <a
          href={`/api/data-tables/${registryId}/template?format=xlsx`}
          className="ghost"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", border: "1px solid var(--border)",
            borderRadius: 6, textDecoration: "none", color: "var(--text)",
            fontSize: 13,
          }}
          title="Télécharger un modèle Excel pré-rempli avec les bonnes colonnes"
        >
          📤 Modèle Excel
        </a>
      </div>

      {(importReport || importError) && (
        <div
          className="card"
          style={{
            display: "flex", alignItems: "flex-start", gap: 10, padding: 12,
            borderColor: importError ? "var(--bad)" : importReport && importReport.errors.length > 0 ? "var(--warn)" : "var(--good)",
            background: importError
              ? "color-mix(in srgb, var(--bad) 8%, var(--panel))"
              : importReport && importReport.errors.length > 0
                ? "color-mix(in srgb, var(--warn) 8%, var(--panel))"
                : "color-mix(in srgb, var(--good) 8%, var(--panel))",
          }}
        >
          <div style={{ flex: 1, fontSize: 13 }}>
            {importError ? (
              <div style={{ color: "var(--bad)" }}>❌ {importError}</div>
            ) : importReport ? (
              <>
                <div style={{ fontWeight: 600 }}>
                  ✅ {importReport.inserted} ligne{importReport.inserted > 1 ? "s" : ""} importée{importReport.inserted > 1 ? "s" : ""}
                  {importReport.total !== importReport.inserted && (
                    <span style={{ color: "var(--warn)" }}> · {importReport.total - importReport.inserted} ignorée(s)</span>
                  )}
                </div>
                {importReport.errors.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: "pointer", color: "var(--warn)", fontSize: 12 }}>
                      Voir les {importReport.errors.length} erreur(s) ▾
                    </summary>
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 12 }}>
                      {importReport.errors.slice(0, 50).map((er, i) => (
                        <li key={i}>Ligne {er.row} : {er.reason}</li>
                      ))}
                      {importReport.errors.length > 50 && <li>…et {importReport.errors.length - 50} de plus</li>}
                    </ul>
                  </details>
                )}
              </>
            ) : null}
          </div>
          <button
            className="ghost"
            onClick={() => { setImportReport(null); setImportError(null); }}
            style={{ padding: "2px 8px" }}
            title="Fermer"
          >
            ×
          </button>
        </div>
      )}

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
                <th style={{ whiteSpace: "nowrap", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const rowId = (r.id as string) ?? "";
                const isDeleting = deletingId === rowId;
                return (
                  <tr key={rowId || i} style={{ opacity: isDeleting ? 0.4 : 1 }}>
                    {displayCols.map((c) => (
                      <td key={c.key} style={{ fontSize: 13, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fmt(r[c.key]) || <em style={{ color: "var(--muted)" }}>—</em>}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", padding: "4px 8px" }}>
                      <button
                        className="ghost"
                        onClick={() => openEdit(r)}
                        disabled={!rowId || isDeleting}
                        style={{ padding: "3px 8px", marginRight: 4, fontSize: 12 }}
                        title="Éditer"
                      >
                        ✎
                      </button>
                      <button
                        className="ghost"
                        onClick={() => deleteRow(r)}
                        disabled={!rowId || isDeleting}
                        style={{ padding: "3px 8px", fontSize: 12, color: "var(--bad)" }}
                        title="Supprimer"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingId && (
        <div
          onClick={() => !editBusy && setEditingId(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, padding: 20, overflowY: "auto",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "min(720px, 100%)", marginTop: 30, display: "grid", gap: 12 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Éditer le contact</h3>
              <button className="ghost" onClick={() => setEditingId(null)} disabled={editBusy} style={{ padding: "2px 8px" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {displayCols.map((c) => (
                <div key={c.key}>
                  <label style={{ fontSize: 12 }}>
                    {c.label}
                    {c.key === phoneColumn && <span style={{ color: "var(--accent)" }}> *</span>}
                  </label>
                  <input
                    type={inputType(c.type)}
                    value={editDraft[c.key] ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            {editError && <div style={{ color: "var(--bad)", fontSize: 13 }}>{editError}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="ghost" onClick={() => setEditingId(null)} disabled={editBusy}>
                Annuler
              </button>
              <button onClick={saveEdit} disabled={editBusy || !editDraft[phoneColumn]?.trim()}>
                {editBusy ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
