"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ColumnSpec {
  key: string;
  label: string;
  type: string;
}

interface Contact {
  id: string;
  display_name: string | null;
  e164: string;
  email: string | null;
  attributes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  listId: string;
  listName: string;
  columns: ColumnSpec[];
  initialContacts: Contact[];
}

interface ImportResult {
  inserted: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export function ContactListDetail({ listId, listName, columns, initialContacts }: Props) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (c.display_name?.toLowerCase().includes(q)) return true;
    if (c.e164.toLowerCase().includes(q)) return true;
    if (c.email?.toLowerCase().includes(q)) return true;
    if (c.attributes && JSON.stringify(c.attributes).toLowerCase().includes(q)) return true;
    return false;
  });

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const r = await fetch(`/api/contact-lists/${listId}/import`, {
        method: "POST",
        body: fd,
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.error ?? `Import failed (${r.status})`);
        return;
      }
      setResult(body as ImportResult);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search (name, phone, email, attribute)…"
          style={{ flex: "1 1 240px", minWidth: 200 }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={onFileChosen}
          style={{ display: "none" }}
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? "Importing…" : "⬆ Import CSV/Excel"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.3)" }}>
          <strong style={{ color: "#ff8080" }}>Import failed:</strong> {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ background: "rgba(80,200,120,0.06)", border: "1px solid rgba(80,200,120,0.3)" }}>
          <strong>✅ Import complete:</strong> {result.inserted} row{result.inserted === 1 ? "" : "s"} imported
          {result.skipped > 0 && `, ${result.skipped} skipped`}.
          {result.errors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                Show {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
              </summary>
              <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13 }}>
                {result.errors.slice(0, 50).map((er, i) => (
                  <li key={i}>
                    {er.row > 0 ? `Row ${er.row}` : "Batch"}: {er.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="card">
          <h3>No contacts in <em>{listName}</em></h3>
          <p className="muted">
            Click <strong>⬆ Import CSV/Excel</strong> above to load your list.
            The file must have a header with a <span className="kbd">phone</span> column (E.164 or local)
            and may contain any column declared in this database.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Phone</th>
                <th>Name</th>
                <th>Email</th>
                {columns.map((c) => (
                  <th key={c.key} style={{ whiteSpace: "nowrap" }}>{c.label}</th>
                ))}
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{c.e164}</td>
                  <td>{c.display_name ?? <em style={{ color: "var(--muted)" }}>—</em>}</td>
                  <td style={{ fontSize: 13 }}>{c.email ?? <em style={{ color: "var(--muted)" }}>—</em>}</td>
                  {columns.map((col) => {
                    const v = c.attributes?.[col.key];
                    return (
                      <td key={col.key} style={{ fontSize: 13, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fmt(v) || <em style={{ color: "var(--muted)" }}>—</em>}
                      </td>
                    );
                  })}
                  <td style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {new Date(c.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
