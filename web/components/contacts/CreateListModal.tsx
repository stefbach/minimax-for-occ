"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * CreateListModal — the "+ Créer une base" flow.
 *
 * UX matches what the user asked for:
 *   1. Name + optional description.
 *   2. A preset library of common columns the user can tick (Nom, IMC,
 *      Qualification, etc.). Each tick adds a fully-typed ColumnSpec.
 *   3. A free-form "add custom column" row for everything not in the
 *      preset library (with a type picker).
 *   4. Submit → POST /api/contact-lists → parent navigates to the new base.
 *
 * The preset library is biased to OCC's leads_rdv schema (BMI, NHS WMP,
 * comorbidities, …) since they're the first tenant, but every option is
 * generic enough to fit any healthcare / lead-management workflow.
 */

type ColumnType = "text" | "number" | "date" | "boolean" | "phone" | "email" | "json";

interface ColumnSpec {
  key: string;
  label: string;
  type: ColumnType;
}

const PRESETS: ColumnSpec[] = [
  // Identity
  { key: "nom",             label: "Nom complet",         type: "text" },
  { key: "firstname",       label: "Prénom",              type: "text" },
  { key: "lastname",        label: "Nom de famille",      type: "text" },
  { key: "patient_dob",     label: "Date de naissance",   type: "date" },
  // Contact channels (phone/email are auto-detected in import, but you can
  // declare them here too so they show in the base's column hints).
  { key: "address",         label: "Adresse",             type: "text" },
  { key: "nhs_number",      label: "Numéro NHS",          type: "text" },
  // Medical (OCC-flavored but generic enough)
  { key: "poids",           label: "Poids (kg)",          type: "number" },
  { key: "taille",          label: "Taille (cm)",         type: "number" },
  { key: "bmi",             label: "IMC",                 type: "number" },
  { key: "allergies",       label: "Allergies",           type: "text" },
  { key: "current_medications", label: "Médicaments actuels", type: "text" },
  { key: "past_surgeries",  label: "Chirurgies passées",  type: "text" },
  { key: "other_chronic_conditions", label: "Autres pathologies", type: "text" },
  { key: "nhs_wmp_status",  label: "Statut NHS WMP",      type: "text" },
  // Pipeline / CRM
  { key: "qualification",   label: "Stage / qualification", type: "text" },
  { key: "note",            label: "Notes du dernier appel", type: "text" },
  { key: "call_outcome",    label: "Résultat dernier appel", type: "text" },
  { key: "source_lead",     label: "Source du lead",      type: "text" },
  { key: "date_rdv",        label: "Date du RDV",         type: "date" },
  { key: "rappel_rdv",      label: "Rappel programmé",    type: "date" },
];

interface NewList {
  id: string;
  name: string;
  description: string | null;
  columns: ColumnSpec[];
  updated_at: string;
  contact_count: number;
}

interface Props {
  onClose: () => void;
  onCreated: (list: NewList) => void;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function CreateListModal({ onClose, onCreated }: Props) {
  const t = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<string>>(
    // Sensible defaults: name + dob + bmi + qualification + note — that's
    // the OCC must-have set.
    new Set(["nom", "patient_dob", "bmi", "qualification", "note"]),
  );
  const [customs, setCustoms] = useState<ColumnSpec[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addCustom() {
    setCustoms((prev) => [...prev, { key: "", label: "", type: "text" }]);
  }

  function updateCustom(idx: number, patch: Partial<ColumnSpec>) {
    setCustoms((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Auto-derive key from label when key is empty.
      if (patch.label !== undefined && !next[idx].key) {
        next[idx].key = slugify(patch.label);
      }
      return next;
    });
  }

  function removeCustom(idx: number) {
    setCustoms((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("Donnez un nom à la base."));
      return;
    }

    // Build the final columns array: presets in their natural order, then customs.
    const presetCols = PRESETS.filter((p) => picked.has(p.key));
    const customCols = customs.filter((c) => c.key && c.label);
    const allCols = [...presetCols, ...customCols];
    // Deduplicate by key (custom shadows preset if the user typed a colliding key).
    const seen = new Set<string>();
    const finalCols: ColumnSpec[] = [];
    for (const c of [...customCols, ...presetCols]) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      finalCols.push(c);
    }
    // Restore preset order for the ones that survived.
    finalCols.sort((a, b) => {
      const ia = PRESETS.findIndex((p) => p.key === a.key);
      const ib = PRESETS.findIndex((p) => p.key === b.key);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return 0;
    });

    setBusy(true);
    try {
      const r = await fetch("/api/contact-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          columns: finalCols,
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.error ?? `Échec création (${r.status})`);
        return;
      }
      onCreated(body as NewList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16,
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: "min(720px, 100%)", maxHeight: "90vh", overflow: "auto",
          display: "grid", gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>{t("Créer une base de contacts")}</h2>
          <button type="button" className="ghost" onClick={onClose}>✕</button>
        </div>

        <div>
          <label>{t("Nom de la base")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex: leads_rdv_test"
            autoFocus
          />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {t("Astuce : un nom court et sans espace facilite l'usage dans les campagnes.")}
          </div>
        </div>

        <div>
          <label>{t("Description (optionnel)")}</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ex: base de test, 10 patients fictifs"
          />
        </div>

        <div>
          <label>{t("Colonnes pré-définies")}</label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("Cochez les colonnes que vos contacts auront. Téléphone et email sont toujours pris en compte automatiquement.")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 6,
              padding: 10,
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            {PRESETS.map((p) => (
              <label
                key={p.key}
                style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  fontSize: 13, padding: "4px 6px",
                }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(p.key)}
                  onChange={() => toggle(p.key)}
                  style={{ width: "auto" }}
                />
                <span>{t(p.label)}</span>
                <span className="kbd" style={{ fontSize: 10, marginLeft: "auto" }}>{p.type}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label>{t("Colonnes personnalisées")}</label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("Ajoutez des colonnes qui ne sont pas dans la liste ci-dessus.")}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {customs.map((c, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 110px auto",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <input
                  value={c.label}
                  onChange={(e) => updateCustom(i, { label: e.target.value })}
                  placeholder={t("Libellé (ex: Statut S2)")}
                />
                <input
                  value={c.key}
                  onChange={(e) => updateCustom(i, { key: slugify(e.target.value) })}
                  placeholder={t("Clé technique (auto)")}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
                <select
                  value={c.type}
                  onChange={(e) => updateCustom(i, { type: e.target.value as ColumnType })}
                  style={{ width: "auto" }}
                >
                  <option value="text">{t("texte")}</option>
                  <option value="number">{t("nombre")}</option>
                  <option value="date">date</option>
                  <option value="boolean">{t("booléen")}</option>
                  <option value="phone">{t("téléphone")}</option>
                  <option value="email">email</option>
                  <option value="json">json</option>
                </select>
                <button type="button" className="ghost" onClick={() => removeCustom(i)} style={{ padding: "6px 10px" }}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="ghost" onClick={addCustom} style={{ justifySelf: "start" }}>
              + {t("Ajouter une colonne")}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: "#ff8080", background: "rgba(255,80,80,0.08)", padding: 10, borderRadius: 6 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" disabled={busy}>
            {busy ? t("Création…") : t("Créer la base")}
          </button>
        </div>
      </form>
    </div>
  );
}
