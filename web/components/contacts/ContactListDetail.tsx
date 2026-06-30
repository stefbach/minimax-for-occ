"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

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
  const t = useT();
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
          placeholder={t("Rechercher (nom, téléphone, email, attribut)…")}
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
          {importing ? t("Importation…") : t("⬆ Importer CSV/Excel")}
        </button>
      </div>

      {error && (
        <div className="card" style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.3)" }}>
          <strong style={{ color: "#ff8080" }}>{t("Échec de l'import :")}</strong> {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ background: "rgba(80,200,120,0.06)", border: "1px solid rgba(80,200,120,0.3)" }}>
          <strong>✅ {t("Import terminé :")}</strong> {result.inserted} {t("ligne")}{result.inserted === 1 ? "" : "s"} {t("importée")}{result.inserted === 1 ? "" : "s"}
          {result.skipped > 0 && `, ${result.skipped} ${t("ignorée")}{result.skipped === 1 ? "" : "s"}`}.
          {result.errors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                {t("Voir")} {result.errors.length} {t("erreur")}{result.errors.length === 1 ? "" : "s"}
              </summary>
              <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13 }}>
                {result.errors.slice(0, 50).map((er, i) => (
                  <li key={i}>
                    {er.row > 0 ? `Ligne ${er.row}` : t("Lot")} : {er.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="card">
          <h3>{t("Aucun contact dans")} <em>{listName}</em></h3>
          <p className="muted">
            {t("Cliquez sur")} <strong>⬆ {t("Importer CSV/Excel")}</strong> {t("ci-dessus pour charger votre liste.")}
            {" "}{t("Le fichier doit avoir un en-tête avec une colonne")} <span className="kbd">phone</span> {t("(E.164 ou local)")}
            {" "}{t("et peut contenir toute colonne déclarée dans cette base.")}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>{t("Téléphone")}</th>
                <th>{t("Nom")}</th>
                <th>{t("Email")}</th>
                {columns.map((c) => (
                  <th key={c.key} style={{ whiteSpace: "nowrap" }}>{c.label}</th>
                ))}
                <th>{t("Mis à jour")}</th>
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
