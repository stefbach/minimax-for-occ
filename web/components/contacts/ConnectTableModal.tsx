"use client";

import { useEffect, useState } from "react";

/**
 * ConnectTableModal — registers an already-existing physical table to the org.
 *
 * The user picks from a DROPDOWN of tables a super-admin assigned to their org
 * (and that aren't already connected) — they never type a raw table name and
 * can never see another tenant's tables. On selection we introspect the
 * columns, let them confirm the phone/name column, then register.
 */

interface IntrospectedCol { key: string; type: string; }
interface Assignable { physical_table: string; note: string | null; }

interface Props {
  onClose: () => void;
  onConnected: (registryId: string) => void;
}

export function ConnectTableModal({ onClose, onConnected }: Props) {
  const [assignable, setAssignable] = useState<Assignable[] | null>(null);
  const [physical, setPhysical] = useState("");
  const [label, setLabel] = useState("");
  const [cols, setCols] = useState<IntrospectedCol[] | null>(null);
  const [phoneCol, setPhoneCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the dropdown of tables assigned to this org but not yet connected.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data-tables/assignable")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setAssignable(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setAssignable([]); });
    return () => { cancelled = true; };
  }, []);

  async function introspect(tableName: string) {
    setError(null);
    setCols(null);
    if (!tableName) return;
    setBusy(true);
    try {
      const r = await fetch("/api/data-tables/register?introspect=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ physical_table: tableName }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? `Échec (${r.status})`); return; }
      const c = body.columns as IntrospectedCol[];
      setCols(c);
      const phoneGuess = c.find((x) => /tel|phone|numero|e164|mobile/i.test(x.key))?.key ?? "";
      const nameGuess = c.find((x) => /nom|name|firstname|fullname/i.test(x.key))?.key ?? "";
      setPhoneCol(phoneGuess);
      setNameCol(nameGuess);
      if (!label) setLabel(tableName);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setError(null);
    if (!phoneCol) { setError("Choisissez la colonne qui contient le téléphone."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/data-tables/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          physical_table: physical,
          label: label.trim() || physical,
          phone_column: phoneCol,
          name_column: nameCol || null,
        }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? `Échec (${r.status})`); return; }
      onConnected(body.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Connecter une table existante</h2>
          <button type="button" className="ghost" onClick={onClose}>✕</button>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Choisissez une table mise à votre disposition. Axon lira ses colonnes automatiquement.
        </p>

        {assignable === null ? (
          <div className="muted" style={{ fontSize: 13 }}>Chargement…</div>
        ) : assignable.length === 0 ? (
          <div style={{ background: "var(--bg-2)", padding: 12, borderRadius: 8, fontSize: 13, color: "var(--muted)" }}>
            Aucune table disponible à connecter pour le moment. Une table doit d&apos;abord vous être
            attribuée par un administrateur Axon (après import dans Supabase).
          </div>
        ) : (
          <div>
            <label>Table disponible</label>
            <select
              value={physical}
              onChange={(e) => { setPhysical(e.target.value); introspect(e.target.value); }}
            >
              <option value="">— choisir une table —</option>
              {assignable.map((a) => (
                <option key={a.physical_table} value={a.physical_table}>
                  {a.physical_table}{a.note ? ` — ${a.note}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {busy && !cols && physical && <div className="muted" style={{ fontSize: 13 }}>Analyse des colonnes…</div>}

        {cols && (
          <>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              ✅ {cols.length} colonne{cols.length === 1 ? "" : "s"} détectée{cols.length === 1 ? "" : "s"}.
            </div>
            <div>
              <label>Nom affiché dans Axon</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Leads RDV (production)" />
            </div>
            <div className="form-row">
              <div>
                <label>Colonne « téléphone » (pour appeler) *</label>
                <select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)}>
                  <option value="">— choisir —</option>
                  {cols.map((c) => <option key={c.key} value={c.key}>{c.key} ({c.type})</option>)}
                </select>
              </div>
              <div>
                <label>Colonne « nom » (optionnel)</label>
                <select value={nameCol} onChange={(e) => setNameCol(e.target.value)}>
                  <option value="">— aucune —</option>
                  {cols.map((c) => <option key={c.key} value={c.key}>{c.key} ({c.type})</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {cols.map((c) => <span key={c.key} className="tag">{c.key}</span>)}
            </div>
          </>
        )}

        {error && <div style={errBox}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="button" onClick={connect} disabled={busy || !cols}>
            {busy && cols ? "Connexion…" : "Connecter la table"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
};
const modal: React.CSSProperties = {
  width: "min(680px, 100%)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14,
};
const errBox: React.CSSProperties = {
  color: "#ff8080", background: "rgba(255,80,80,0.08)", padding: 10, borderRadius: 6,
};
