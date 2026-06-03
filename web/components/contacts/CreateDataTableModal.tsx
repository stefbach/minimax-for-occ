"use client";

import { useState } from "react";

/**
 * CreateDataTableModal — creates a REAL Postgres table for the tenant.
 * The user names it (physical_table), ticks preset columns, optionally adds
 * custom ones, and designates which column holds the phone (used for dialing)
 * and which holds the display name.
 */

type ColumnType = "text" | "number" | "date" | "datetime" | "boolean" | "phone" | "email" | "json";
interface ColumnSpec { key: string; label: string; type: ColumnType; }

// Preset library grouped: generic identity/address fields any business needs,
// CRM/pipeline fields, then OCC-style medical extras. The user ticks what they
// need and can add custom columns for anything else.
interface PresetGroup { title: string; cols: ColumnSpec[]; }
const PRESET_GROUPS: PresetGroup[] = [
  {
    title: "Identité",
    cols: [
      { key: "nom",              label: "Nom",                type: "text" },
      { key: "prenom",           label: "Prénom",             type: "text" },
      { key: "numero_telephone", label: "Téléphone",          type: "phone" },
      { key: "email",            label: "Email",              type: "email" },
      { key: "patient_dob",      label: "Date de naissance",  type: "date" },
      { key: "civilite",         label: "Civilité",           type: "text" },
      { key: "langue",           label: "Langue",             type: "text" },
    ],
  },
  {
    title: "Adresse",
    cols: [
      { key: "adresse",      label: "Adresse",      type: "text" },
      { key: "ville",        label: "Ville",        type: "text" },
      { key: "code_postal",  label: "Code postal",  type: "text" },
      { key: "pays",         label: "Pays",         type: "text" },
    ],
  },
  {
    title: "CRM / Suivi",
    cols: [
      { key: "qualification", label: "Qualification",   type: "text" },
      { key: "note",          label: "Note",            type: "text" },
      { key: "call_outcome",  label: "Résultat appel",  type: "text" },
      { key: "source_lead",   label: "Source du lead",  type: "text" },
      { key: "date_rdv",      label: "Date RDV",        type: "date" },
      { key: "rappel_rdv",    label: "Rappel RDV",      type: "datetime" },
      { key: "statut",        label: "Statut",          type: "text" },
    ],
  },
  {
    title: "Santé (optionnel)",
    cols: [
      { key: "poids",               label: "Poids (kg)",         type: "number" },
      { key: "taille",              label: "Taille (cm)",        type: "number" },
      { key: "bmi",                 label: "IMC",                type: "number" },
      { key: "nhs_wmp_status",      label: "Statut NHS WMP",     type: "text" },
      { key: "allergies",           label: "Allergies",          type: "text" },
      { key: "current_medications", label: "Médicaments",        type: "text" },
      { key: "past_surgeries",      label: "Chirurgies passées", type: "text" },
    ],
  },
];
const PRESETS: ColumnSpec[] = PRESET_GROUPS.flatMap((g) => g.cols);

function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 62);
}

interface Props {
  onClose: () => void;
  onCreated: (registryId: string) => void;
}

export function CreateDataTableModal({ onClose, onCreated }: Props) {
  const [label, setLabel] = useState("");
  const [physical, setPhysical] = useState("");
  const [physicalEdited, setPhysicalEdited] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(
    new Set(["nom", "numero_telephone", "patient_dob", "bmi", "qualification", "note"]),
  );
  const [customs, setCustoms] = useState<ColumnSpec[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const phys = (physicalEdited ? physical : slug(label)).trim();
    if (!/^[a-z][a-z0-9_]{2,62}$/.test(phys)) {
      setError("Nom technique invalide (a-z, 0-9, _, min 3 caractères, commence par une lettre).");
      return;
    }
    const presetCols = PRESETS.filter((p) => picked.has(p.key));
    const customCols = customs.filter((c) => c.key && c.label);
    // dedupe by key, customs win
    const seen = new Set<string>();
    const columns: ColumnSpec[] = [];
    for (const c of [...customCols, ...presetCols]) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      columns.push(c);
    }
    // ensure a phone column is present
    const phoneCol = columns.find((c) => c.type === "phone")?.key
      || (picked.has("numero_telephone") ? "numero_telephone" : "numero_telephone");
    const nameCol = columns.find((c) => c.key === "nom")?.key ?? null;

    setBusy(true);
    try {
      const r = await fetch("/api/data-tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          physical_table: phys,
          label: label.trim() || phys,
          columns,
          phone_column: phoneCol,
          name_column: nameCol,
        }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? `Échec (${r.status})`); return; }
      onCreated(body.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="card" style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Créer une table de contacts</h2>
          <button type="button" className="ghost" onClick={onClose}>✕</button>
        </div>

        <div className="form-row">
          <div>
            <label>Nom affiché</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Leads RDV (test)" autoFocus />
          </div>
          <div>
            <label>Nom technique (table SQL)</label>
            <input
              value={physicalEdited ? physical : slug(label)}
              onChange={(e) => { setPhysicalEdited(true); setPhysical(slug(e.target.value)); }}
              placeholder="leads_rdv_test_axon"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              C&apos;est le nom que verront vos automations n8n.
            </div>
          </div>
        </div>

        <div>
          <label>Colonnes pré-définies</label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Cochez celles dont vous avez besoin. La colonne <span className="kbd">téléphone</span> est
            obligatoire (pour appeler).
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {PRESET_GROUPS.map((group) => (
              <div key={group.title}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                  {group.title}
                </div>
                <div style={presetGrid}>
                  {group.cols.map((p) => (
                    <label key={p.key} style={presetItem}>
                      <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)}
                        disabled={p.key === "numero_telephone"} style={{ width: "auto" }} />
                      <span>{p.label}</span>
                      <span className="kbd" style={{ fontSize: 10, marginLeft: "auto" }}>{p.type}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label>Colonnes personnalisées</label>
          <div style={{ display: "grid", gap: 8 }}>
            {customs.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px auto", gap: 6 }}>
                <input value={c.label} placeholder="Libellé"
                  onChange={(e) => setCustoms((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value, key: x.key || slug(e.target.value) } : x))} />
                <input value={c.key} placeholder="cle_technique" style={{ fontFamily: "monospace", fontSize: 12 }}
                  onChange={(e) => setCustoms((p) => p.map((x, j) => j === i ? { ...x, key: slug(e.target.value) } : x))} />
                <select value={c.type} style={{ width: "auto" }}
                  onChange={(e) => setCustoms((p) => p.map((x, j) => j === i ? { ...x, type: e.target.value as ColumnType } : x))}>
                  <option value="text">texte</option>
                  <option value="number">nombre</option>
                  <option value="date">date</option>
                  <option value="datetime">date+heure</option>
                  <option value="boolean">booléen</option>
                  <option value="email">email</option>
                  <option value="json">json</option>
                </select>
                <button type="button" className="ghost" onClick={() => setCustoms((p) => p.filter((_, j) => j !== i))} style={{ padding: "6px 10px" }}>✕</button>
              </div>
            ))}
            <button type="button" className="ghost" style={{ justifySelf: "start" }}
              onClick={() => setCustoms((p) => [...p, { key: "", label: "", type: "text" }])}>
              + Ajouter une colonne
            </button>
          </div>
        </div>

        {error && <div style={errBox}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={busy}>{busy ? "Création…" : "Créer la table"}</button>
        </div>
      </form>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
};
const modal: React.CSSProperties = {
  width: "min(760px, 100%)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14,
};
const presetGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6,
  padding: 10, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8,
};
const presetItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, padding: "4px 6px",
};
const errBox: React.CSSProperties = {
  color: "#ff8080", background: "rgba(255,80,80,0.08)", padding: 10, borderRadius: 6,
};
