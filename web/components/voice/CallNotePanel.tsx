"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

interface Props {
  /** E.164 number being called (e.g. "+447700123456"). */
  e164: string;
  /** True while a call is ringing or in progress on the softphone. */
  callActive: boolean;
  /** Set by Softphone when the call ends — triggers the qualification dialog. */
  lastCallEndedAt: number | null;
  /** ID of the most recently ended call (resolved from the calls table by
   *  Softphone), used to attach the qualification + manual notes to the
   *  right row. */
  lastCallId: string | null;
}

type LeadLookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "found"; contact_id: string; display_name: string | null; note: string | null }
  | { state: "not_found" };

/**
 * Right-hand panel beside the softphone for the HUMAN agent:
 *  - Loads the lead matching the dialed number (by phone).
 *  - If found → shows the patient note textarea, autosaves to leads_rdv.
 *  - If NOT found → shows a 'Create lead' mini-form (nom, email, etc.).
 *  - When the call ends → shows the manual qualification dialog
 *    (PAS DE REPONSE / RAPPEL / RDV CONFIRME / PAS INTERESSE / …) so the
 *    human can post-tag the call (IA does this auto for IA calls).
 *
 * Wati June 10: 'A coter dialer, section note pendant appel; quand
 * l'agent save, ca va dans note du lead, et si le lead n'existe pas,
 * creer le lead… Permettre à l'agent humain de poser la qualif après
 * l'appel via un dialog "PAS DE REPONSE / RAPPEL / RDV / etc"'.
 */
export function CallNotePanel({ e164, callActive, lastCallEndedAt, lastCallId }: Props) {
  const t = useT();
  const [lookup, setLookup] = useState<LeadLookup>({ state: "idle" });
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState({ nom: "", email: "", note: "" });
  const [createErr, setCreateErr] = useState<string | null>(null);
  // Qualification dialog appears 1s after the call ends so the agent has
  // time to finish their last keystroke before being prompted.
  const [showQualDialog, setShowQualDialog] = useState(false);
  const [qualSaving, setQualSaving] = useState(false);
  const [qualSavedAt, setQualSavedAt] = useState<number | null>(null);
  const lastShownEndRef = useRef<number | null>(null);

  // Look up the lead whenever the dialed number changes (and is valid).
  useEffect(() => {
    if (!/^\+\d{6,15}$/.test(e164)) {
      setLookup({ state: "idle" });
      return;
    }
    let cancelled = false;
    setLookup({ state: "loading" });
    void (async () => {
      try {
        const r = await fetch(`/api/desk/lead-by-phone?e164=${encodeURIComponent(e164)}`, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setLookup({ state: "not_found" });
          return;
        }
        const j = (await r.json()) as { found: boolean; contact_id?: string; display_name?: string | null; note?: string | null };
        if (cancelled) return;
        if (j.found && j.contact_id) {
          setLookup({ state: "found", contact_id: j.contact_id, display_name: j.display_name ?? null, note: j.note ?? null });
          setNoteDraft(j.note ?? "");
        } else {
          setLookup({ state: "not_found" });
        }
      } catch {
        if (!cancelled) setLookup({ state: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [e164]);

  // Trigger the qualification dialog on call-end (once per ended call).
  useEffect(() => {
    if (lastCallEndedAt && lastCallEndedAt !== lastShownEndRef.current && lastCallId) {
      lastShownEndRef.current = lastCallEndedAt;
      const t = setTimeout(() => setShowQualDialog(true), 800);
      return () => clearTimeout(t);
    }
  }, [lastCallEndedAt, lastCallId]);

  const saveNote = useCallback(async () => {
    if (lookup.state !== "found") return;
    setSavingNote(true);
    try {
      const r = await fetch(`/api/desk/patient-note/${lookup.contact_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: noteDraft }),
      });
      if (r.ok) setSavedAt(Date.now());
    } finally {
      setSavingNote(false);
    }
  }, [lookup, noteDraft]);

  async function createLead() {
    setCreateErr(null);
    if (!createDraft.nom.trim()) {
      setCreateErr(t("Le nom est requis."));
      return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/desk/lead-by-phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164, nom: createDraft.nom, email: createDraft.email, note: createDraft.note }),
      });
      const j = (await r.json()) as { contact_id?: string; display_name?: string | null; error?: string };
      if (!r.ok || !j.contact_id) {
        setCreateErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setLookup({ state: "found", contact_id: j.contact_id, display_name: j.display_name ?? createDraft.nom, note: createDraft.note });
      setNoteDraft(createDraft.note);
      setCreateDraft({ nom: "", email: "", note: "" });
    } finally {
      setCreating(false);
    }
  }

  const QUAL_OPTIONS = [
    { value: "PAS DE REPONSE", label: t("Pas de réponse") },
    { value: "REPONDEUR", label: t("Répondeur") },
    { value: "RAPPEL", label: t("Rappel") },
    { value: "RDV CONFIRME", label: t("RDV confirmé") },
    { value: "PAS INTERESSE", label: t("Pas intéressé") },
    { value: "A PASSER A L'HUMAIN", label: t("À passer à un humain (autre)") },
    { value: "FAUX NUMERO", label: t("Faux numéro") },
    { value: "NE PAS RAPPELER", label: t("Ne pas rappeler") },
  ];

  async function saveQualification(qual: string) {
    if (!lastCallId) return;
    setQualSaving(true);
    try {
      const r = await fetch(`/api/desk/manual-qualify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ call_id: lastCallId, qualification: qual, contact_id: lookup.state === "found" ? lookup.contact_id : null }),
      });
      if (r.ok) {
        setQualSavedAt(Date.now());
        setTimeout(() => setShowQualDialog(false), 1200);
      }
    } finally {
      setQualSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 260, maxWidth: 360 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("Notes pendant l'appel")}</h3>

      {lookup.state === "idle" && (
        <div className="muted" style={{ fontSize: 12 }}>{t("Tape un numéro pour rechercher le lead.")}</div>
      )}
      {lookup.state === "loading" && (
        <div className="muted" style={{ fontSize: 12 }}>{t("Recherche du lead…")}</div>
      )}

      {lookup.state === "found" && (
        <>
          <div style={{ fontSize: 13 }}>
            <strong>{lookup.display_name ?? t("Lead trouvé")}</strong>
            <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{e164}</span>
          </div>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={6}
            placeholder={t("Notes prises pendant l'appel…")}
            style={{ width: "100%", resize: "vertical", fontSize: 13, fontFamily: "inherit" }}
            disabled={!callActive && lookup.note === noteDraft}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={saveNote} disabled={savingNote || noteDraft === (lookup.note ?? "")}>
              {savingNote ? t("Enregistrement…") : t("Enregistrer")}
            </button>
            {savedAt && Date.now() - savedAt < 3000 && (
              <span style={{ color: "var(--good)", fontSize: 12 }}>{t("✓ Sauvegardé")}</span>
            )}
          </div>
        </>
      )}

      {lookup.state === "not_found" && (
        <>
          <div className="muted" style={{ fontSize: 12, padding: "6px 0" }}>
            {t("Lead introuvable. Créer la fiche :")}
          </div>
          <input
            value={createDraft.nom}
            onChange={(e) => setCreateDraft((d) => ({ ...d, nom: e.target.value }))}
            placeholder={t("Nom complet *")}
            style={{ fontSize: 13 }}
          />
          <input
            value={createDraft.email}
            onChange={(e) => setCreateDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder={t("Email (optionnel)")}
            type="email"
            style={{ fontSize: 13 }}
          />
          <textarea
            value={createDraft.note}
            onChange={(e) => setCreateDraft((d) => ({ ...d, note: e.target.value }))}
            rows={3}
            placeholder={t("Note initiale (optionnel)")}
            style={{ width: "100%", resize: "vertical", fontSize: 13, fontFamily: "inherit" }}
          />
          {createErr && <div style={{ color: "var(--bad)", fontSize: 12 }}>{createErr}</div>}
          <button onClick={createLead} disabled={creating || !createDraft.nom.trim()}>
            {creating ? t("Création…") : t("Créer le lead")}
          </button>
        </>
      )}

      {showQualDialog && lastCallId && (
        <div
          onClick={() => !qualSaving && setShowQualDialog(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "min(420px, 100%)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{t("Comment qualifies-tu cet appel ?")}</h3>
              <button className="ghost" onClick={() => setShowQualDialog(false)} disabled={qualSaving}>×</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{lookup.state === "found" ? lookup.display_name : e164}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {QUAL_OPTIONS.map((q) => (
                <button
                  key={q.value}
                  onClick={() => saveQualification(q.value)}
                  disabled={qualSaving}
                  style={{ padding: "8px 10px", fontSize: 13 }}
                >
                  {q.label}
                </button>
              ))}
            </div>
            {qualSavedAt && Date.now() - qualSavedAt < 3000 && (
              <div style={{ color: "var(--good)", fontSize: 12, textAlign: "center" }}>{t("✓ Qualification enregistrée")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
