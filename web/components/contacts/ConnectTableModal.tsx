"use client";

import { useState } from "react";

/**
 * ConnectTableModal — registers an ALREADY-EXISTING physical table (e.g.
 * leads_rdv imported via the Supabase dashboard) to the org.
 *
 * Flow: type the table name → "Analyser" introspects its columns → user
 * confirms which column is the phone (for dialing) and which is the name →
 * "Connecter" registers it.
 */

interface IntrospectedCol { key: string; type: string; }

interface Props {
  onClose: () => void;
  onConnected: (registryId: string) => void;
}

export function ConnectTableModal({ onClose, onConnected }: Props) {
  const [physical, setPhysical] = useState("");
  const [label, setLabel] = useState("");
  const [cols, setCols] = useState<IntrospectedCol[] | null>(null);
  const [phoneCol, setPhoneCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function introspect() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/data-tables/register?introspect=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ physical_table: physical.trim().toLowerCase() }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? `Échec (${r.status})`); setCols(null); return; }
      const c = body.columns as IntrospectedCol[];
      setCols(c);
      // Smart defaults for phone/name column.
      const phoneGuess = c.find((x) => /tel|phone|numero|e164|mobile/i.test(x.key))?.key ?? "";
      const nameGuess = c.find((x) => /nom|name|firstname|fullname/i.test(x.key))?.key ?? "";
      setPhoneCol(phoneGuess);
      setNameCol(nameGuess);
      if (!label) setLabel(physical.trim());
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
          physical_table: physical.trim().toLowerCase(),
          label: label.trim() || physical.trim(),
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
          Indiquez le nom d&apos;une table déjà présente dans votre projet Supabase
          (par exemple <span className="kbd">leads_rdv</span> que vous avez importée).
          Axon va lire ses colonnes automatiquement.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label>Nom de la table</label>
            <input
              value={physical}
              onChange={(e) => { setPhysical(e.target.value); setCols(null); }}
              placeholder="leads_rdv"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
          </div>
          <button type="button" onClick={introspect} disabled={busy || !physical.trim()}>
            {busy && !cols ? "Analyse…" : "Analyser"}
          </button>
        </div>

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
