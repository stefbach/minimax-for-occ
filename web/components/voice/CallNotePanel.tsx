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

  // Wati 16/06 — removed the visible "Notes pendant l'appel" card. The
  // right-hand ContactPanel already exposes a note input + interactions
  // history, no need for a duplicate textarea here. We keep this component
  // mounted because it still owns the post-call qualification dialog,
  // which fires once the call ends.
  // Suppress unused-variable noise from the lookup/lead flow we kept for
  // the qualification submission (contact_id link) but don't render here.
  void lookup;
  void noteDraft;
  void setNoteDraft;
  void savingNote;
  void savedAt;
  void saveNote;
  void creating;
  void createDraft;
  void setCreateDraft;
  void createErr;
  void createLead;
  void callActive;
  return (
    <>
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
    </>
  );
}
