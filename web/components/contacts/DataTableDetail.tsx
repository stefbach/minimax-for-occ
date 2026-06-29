"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
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
  /** Column that holds the display name — used by the "Appeler" action to
   *  pass the patient name through to the softphone as context. Optional;
   *  when null the call still goes through, just without the friendly label. */
  nameColumn?: string | null;
  initialRows: Record<string, unknown>[];
  /** Total row count for the underlying physical table — used by the
   *  pager to render "X / total" and disable the "next" button on the
   *  last page. Falls back to initialRows.length when omitted. */
  initialTotal?: number;
  /** Page size used by the server for the SSR-rendered first page.
   *  Defaults to 20 (matches the page-size selector default). */
  initialPerPage?: number;
}

// Page size choices offered to the user. "all" sends per_page=all to the
// API, which falls back to the server's hard cap (10k). Wati 2026-06-15:
// default 20, with 50/100/all as opt-ins.
const PAGE_SIZE_OPTIONS: Array<{ value: number | "all"; label: string }> = [
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: "all", label: "Tout" },
];

type ImportReport = {
  inserted: number;
  total: number;
  errors: { row: number; reason: string }[];
};

// Columns we render INLINE in the table — Zoho-style short summary that
// fits on one line per row. Everything else (call_history, notes,
// documents, etc.) only shows in the detail drawer. Wati's June 10
// note: the table was scrolling 20 lines per contact because every
// long column was inlined ("trop scroller pour voir toute la liste").
const SUMMARY_COL_KEYS = new Set([
  "nom", "email", "bmi", "qualification", "current_phase",
  "j1_attempts", "j3_attempts", "j5_attempts",
  "last_qualification_update", "date_rdv", "rappel_rdv",
  "do_not_call", "voicemail_detected", "cycle_status",
]);

export function DataTableDetail({
  registryId,
  columns,
  phoneColumn,
  nameColumn,
  initialRows,
  initialTotal,
  initialPerPage = 20,
}: Props) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState<number>(initialTotal ?? initialRows.length);
  // Pre-fill from ?q= URL param so dashboard patient search can deep-link here.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  // Pagination state (Wati 2026-06-15): server-driven page/per_page so a
  // 7800-row table doesn't dump everything into the DOM. The first page
  // ships with the SSR payload (initialRows); every subsequent
  // page/perPage/search change refetches via /api/data-tables/.../rows.
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | "all">(initialPerPage);
  const [fetching, setFetching] = useState(false);
  // Tracks whether the on-screen rows came from the server fetch (vs. the
  // SSR payload). Keeps the "X / Y" counter honest when filters change.
  const isFirstLoad = useRef(true);

  // Reset to page 1 whenever the search term or page size changes — Wati
  // 2026-06-15: typing in search while on page 4 of a different filter
  // would land on an out-of-range page and show nothing.
  useEffect(() => {
    setPage(1);
  }, [search, perPage]);

  useEffect(() => {
    // The SSR payload IS page 1 of the default listing — skip the fetch
    // for that exact case so we don't double-load on mount.
    if (
      isFirstLoad.current &&
      page === 1 &&
      perPage === initialPerPage &&
      search.trim() === ""
    ) {
      isFirstLoad.current = false;
      return;
    }
    isFirstLoad.current = false;
    const q = search.trim();
    setFetching(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        params.set("page", String(page));
        params.set("per_page", perPage === "all" ? "all" : String(perPage));
        const r = await fetch(
          `/api/data-tables/${registryId}/rows?${params.toString()}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (r.ok && Array.isArray(j.rows)) {
          setRows(j.rows);
          if (typeof j.total === "number") setTotal(j.total);
        } else {
          setRows([]);
          setTotal(0);
        }
      } catch {
        setRows([]);
        setTotal(0);
      } finally {
        setFetching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search, page, perPage, registryId, initialPerPage]);
  const [qualFilter, setQualFilter] = useState<string>("");
  const [phaseFilter, setPhaseFilter] = useState<string>("");
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

  // Full column list (used by the detail drawer + import + add form).
  const allCols: ColumnSpec[] = [
    { key: phoneColumn, label: "Téléphone", type: "phone" },
    ...columns.filter((c) => c.key !== phoneColumn),
  ];
  // Inline-table columns: phone + curated summary set. Any column that's
  // declared and matches SUMMARY_COL_KEYS shows up; the rest stay in the
  // drawer.
  const displayCols: ColumnSpec[] = [
    { key: phoneColumn, label: "Téléphone", type: "phone" },
    ...columns.filter((c) => c.key !== phoneColumn && SUMMARY_COL_KEYS.has(c.key)),
  ];

  // Distinct values for the quick filters (qualification + current_phase).
  const distinctQuals = Array.from(
    new Set(
      rows
        .map((r) => String(r["qualification"] ?? "").trim())
        .filter(Boolean),
    ),
  ).sort();
  const distinctPhases = Array.from(
    new Set(
      rows
        .map((r) => String(r["current_phase"] ?? "").trim())
        .filter(Boolean),
    ),
  ).sort();

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "boolean") return v ? "oui" : "non";
    return String(v);
  }

  // Server-driven pagination (Wati 2026-06-15): `rows` already reflects
  // the active page + search term. Quick qualification/phase filters
  // still apply client-side on top of the visible window — they only
  // narrow the current page rather than triggering a new fetch, which
  // matches how Zoho/HubSpot scope quick-filters to the loaded view.
  const filtered = rows.filter((r) => {
    if (qualFilter && String(r["qualification"] ?? "") !== qualFilter) return false;
    if (phaseFilter && String(r["current_phase"] ?? "") !== phaseFilter) return false;
    return true;
  });

  // Total number of pages — relies on the server's `total` count. When
  // perPage === "all" we collapse to a single page even if the server
  // capped the result set.
  const totalPages =
    perPage === "all" ? 1 : Math.max(1, Math.ceil(total / perPage));
  const canPrev = page > 1;
  const canNext = page < totalPages;

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
      setTotal((prev) => prev + 1);
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
    // Load EVERY column into the edit drawer — the inline table only shows
    // summary columns, but the drawer is where the full record lives.
    const initial: Record<string, string> = {};
    for (const c of allCols) {
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
    if (!confirm(`${t("Supprimer ce contact")} (${label}) ? ${t("Cette action est irréversible.")}`)) return;
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
      setTotal((prev) => Math.max(0, prev - 1));
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

  // Column keys we expect to hold long free-text — render as textarea in
  // the edit modal and let the table cell expand vertically.
  const LONG_TEXT_KEYS = new Set([
    "note", "notes", "call_1_note", "call_2_note", "call_3_note",
    "raison_ne_pas_rappeler", "call_outcome", "call_error",
    "nhs_wmp_details", "received_documents", "missing_documents",
    "other_chronic_conditions", "past_surgeries", "current_medications",
    "allergies", "anesthesia_allergies",
  ]);
  const isLongText = (key: string, type: string) =>
    type === "text" && (LONG_TEXT_KEYS.has(key) || key.endsWith("_note") || key.endsWith("_notes"));

  return (
    <>
      <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          style={{ flex: "1 1 200px", minWidth: 160 }}
        />
        {distinctQuals.length > 0 && (
          <select value={qualFilter} onChange={(e) => setQualFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="">{t("Toutes qualifications")}</option>
            {distinctQuals.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        )}
        {distinctPhases.length > 0 && (
          <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="">{t("Toutes phases")}</option>
            {distinctPhases.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
        {(qualFilter || phaseFilter || search) && (
          <button className="ghost" onClick={() => { setQualFilter(""); setPhaseFilter(""); setSearch(""); }} style={{ fontSize: 12 }}>
            ✕ {t("Réinitialiser")}
          </button>
        )}
        <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>
          {fetching
            ? "Chargement…"
            : search.trim()
              ? `${filtered.length} affiché${filtered.length > 1 ? "s" : ""} · ${total} trouvé${total > 1 ? "s" : ""}`
              : `${filtered.length} / ${total}`}
        </span>
        {/* Pagination (Wati 2026-06-15): prev / next + page-size selector.
            Sits in the toolbar so it's always visible above the table.
            Page-size "Tout" sends per_page=all to the API; the server
            caps at 10k rows. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 8,
            fontSize: 12,
          }}
        >
          <label style={{ color: "var(--muted)" }}>{t("Par page")}</label>
          <select
            value={String(perPage)}
            onChange={(e) => {
              const v = e.target.value;
              setPerPage(v === "all" ? "all" : Number.parseInt(v, 10));
            }}
            style={{ fontSize: 12, padding: "2px 4px" }}
          >
            {PAGE_SIZE_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            className="ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!canPrev || fetching}
            style={{ padding: "2px 8px", fontSize: 12 }}
            aria-label="Page précédente"
          >
            ‹ Précédent
          </button>
          <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
            Page {page} / {totalPages}
          </span>
          <button
            className="ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={!canNext || fetching}
            style={{ padding: "2px 8px", fontSize: 12 }}
            aria-label="Page suivante"
          >
            Suivant ›
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAdd((v) => !v)}>{showAdd ? t("Annuler") : t("+ Ajouter un contact")}</button>
        <button
          className="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy}
          title="Importer un fichier CSV ou Excel"
        >
          {importBusy ? t("Import…") : `📥 ${t("Importer CSV/Excel")}`}
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
          📤 {t("Modèle Excel")}
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
                      {t("Voir les")} {importReport.errors.length} {t("erreur(s)")} ▾
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
            title={t("Fermer")}
          >
            ×
          </button>
        </div>
      )}

      {showAdd && (
        <form className="card" onSubmit={addRow} style={{ display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>{t("Nouveau contact")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {allCols.map((c) => {
              const long = isLongText(c.key, c.type);
              return (
                <div key={c.key} style={long ? { gridColumn: "1 / -1" } : undefined}>
                  <label style={{ fontSize: 12 }}>
                    {c.label}
                    {c.key === phoneColumn && <span style={{ color: "var(--accent)" }}> *</span>}
                  </label>
                  {long ? (
                    <textarea
                      value={draft[c.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                      rows={4}
                      style={{ width: "100%", resize: "vertical", minHeight: 80, fontFamily: "inherit", fontSize: 13 }}
                    />
                  ) : (
                    <input
                      type={inputType(c.type)}
                      value={draft[c.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                      placeholder={c.key === phoneColumn ? "+44..." : ""}
                      style={{ width: "100%" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {error && <div style={{ color: "#ff8080" }}>{error}</div>}
          <div>
            <button type="submit" disabled={busy}>{busy ? t("Ajout…") : t("Ajouter")}</button>
          </div>
        </form>
      )}

      {error && !showAdd && (
        <div className="card" style={{ color: "#ff8080" }}>{error}</div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <h3>{t("Table vide")}</h3>
          <p className="muted">
            {t("Ajoutez des contacts un par un avec « + Ajouter un contact », ou importez un CSV depuis Supabase. Pour tester, mettez 2-3 numéros que vous pouvez appeler vous-même.")}
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
                <th
                  style={{
                    whiteSpace: "nowrap",
                    textAlign: "right",
                    position: "sticky",
                    right: 0,
                    background: "var(--panel)",
                    boxShadow: "-4px 0 6px -4px rgba(0,0,0,0.25)",
                    zIndex: 2,
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const rowId = (r.id as string) ?? "";
                const isDeleting = deletingId === rowId;
                return (
                  <tr
                    key={rowId || i}
                    style={{ opacity: isDeleting ? 0.4 : 1, cursor: rowId ? "pointer" : "default" }}
                    onClick={(e) => {
                      // Don't open the drawer when the click landed on the
                      // Actions column buttons (sticky right column).
                      const target = e.target as HTMLElement;
                      if (target.closest("button, a, select, input, textarea")) return;
                      if (rowId) openEdit(r);
                    }}
                  >
                    {displayCols.map((c) => {
                      const raw = fmt(r[c.key]);
                      return (
                        <td
                          key={c.key}
                          style={{
                            fontSize: 13,
                            maxWidth: 200,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            verticalAlign: "middle",
                            padding: "8px 10px",
                          }}
                          title={raw || undefined}
                        >
                          {raw || <em style={{ color: "var(--muted)" }}>—</em>}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        padding: "4px 8px",
                        position: "sticky",
                        right: 0,
                        background: "var(--panel)",
                        boxShadow: "-4px 0 6px -4px rgba(0,0,0,0.25)",
                        zIndex: 1,
                      }}
                    >
                      {(() => {
                        // "Appeler" button — Wati 2026-06-11: an agent on
                        // /contacts who wants to dial a patient should not have
                        // to copy-paste the number into the softphone. The
                        // link lands on /desk with prefill + name params; the
                        // Softphone reads those and the dial pad is ready in
                        // one click.
                        const phoneRaw = String(r[phoneColumn] ?? "").trim();
                        const phoneOk = /^\+\d{6,15}$/.test(phoneRaw);
                        const nameRaw = nameColumn ? String(r[nameColumn] ?? "").trim() : "";
                        const href = phoneOk
                          ? `/desk?prefill=${encodeURIComponent(phoneRaw)}` +
                            (nameRaw ? `&name=${encodeURIComponent(nameRaw)}` : "")
                          : null;
                        return href ? (
                          <Link
                            href={href}
                            className="ghost"
                            style={{
                              padding: "3px 8px",
                              marginRight: 4,
                              fontSize: 12,
                              textDecoration: "none",
                              color: "var(--accent)",
                              border: "1px solid var(--accent)",
                              borderRadius: 5,
                              display: "inline-block",
                            }}
                            title={t("Composer ce numéro depuis Mon poste")}
                          >
                            ☎ {t("Appeler")}
                          </Link>
                        ) : null;
                      })()}
                      <button
                        className="ghost"
                        onClick={() => openEdit(r)}
                        disabled={!rowId || isDeleting}
                        style={{ padding: "3px 8px", marginRight: 4, fontSize: 12 }}
                        title={t("Voir la fiche complète")}
                      >
                        {t("Voir")}
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
              <h3 style={{ margin: 0 }}>{t("Fiche complète du contact")}</h3>
              <button className="ghost" onClick={() => setEditingId(null)} disabled={editBusy} style={{ padding: "2px 8px" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {allCols.map((c) => {
                const long = isLongText(c.key, c.type);
                return (
                  <div key={c.key} style={long ? { gridColumn: "1 / -1" } : undefined}>
                    <label style={{ fontSize: 12 }}>
                      {c.label}
                      {c.key === phoneColumn && <span style={{ color: "var(--accent)" }}> *</span>}
                    </label>
                    {long ? (
                      <textarea
                        value={editDraft[c.key] ?? ""}
                        onChange={(e) => setEditDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                        rows={4}
                        style={{ width: "100%", resize: "vertical", minHeight: 80, fontFamily: "inherit", fontSize: 13 }}
                      />
                    ) : (
                      <input
                        type={inputType(c.type)}
                        value={editDraft[c.key] ?? ""}
                        onChange={(e) => setEditDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                        style={{ width: "100%" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {editError && <div style={{ color: "var(--bad)", fontSize: 13 }}>{editError}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="ghost" onClick={() => setEditingId(null)} disabled={editBusy}>
                {t("Annuler")}
              </button>
              <button onClick={saveEdit} disabled={editBusy || !editDraft[phoneColumn]?.trim()}>
                {editBusy ? t("Enregistrement…") : t("Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
