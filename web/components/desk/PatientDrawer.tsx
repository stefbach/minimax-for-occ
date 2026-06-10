"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

interface Props {
  contactId: string;
  /** Display name shown in the header until the lead row loads. */
  displayName?: string | null;
  /** Phone shown in the header until the lead row loads. */
  e164?: string | null;
  onClose: () => void;
  /** Optional headline (e.g. the task qualification chip) shown in the header. */
  headline?: string;
}

interface PatientContext {
  identity?: { nom?: string | null; email?: string | null; dob?: string | null };
  clinical?: {
    bmi?: number | null;
    poids?: number | null;
    taille?: number | null;
    allergies?: string | null;
    anesthesia_allergies?: string | null;
    current_medications?: string | null;
    past_surgeries?: string | null;
    other_chronic_conditions?: string | null;
  };
  nhs?: {
    wmp_status?: string | null;
    wmp_details?: string | null;
    document_status?: string | null;
    received_documents?: string | null;
    missing_documents?: string | null;
  };
  funnel?: {
    qualification?: string | null;
    call_count?: number;
    last_call?: string | null;
    last_response?: string | null;
    cycle_status?: string | null;
    current_phase?: string | null;
  };
  notes?: {
    call_1?: string | null;
    call_2?: string | null;
    call_3?: string | null;
    free?: string | null;
  };
  source?: { source_lead?: string | null; form_facebook?: string | null };
}

interface CallSummary {
  id: string;
  started_at: string;
  duration_secs: number | null;
  direction: string | null;
  qualification: string | null;
  summary: string | null;
  agent_name: string | null;
}

/**
 * CRM-style patient details overlay. Opens on click from /desk/supervise
 * and /mes-patients (Wati June 10 spec: 'patient cliquable comme dans
 * CRM'). Loads patient-context + last 10 calls, lets the agent edit the
 * note column inline.
 */
export function PatientDrawer({ contactId, displayName, e164, onClose, headline }: Props) {
  const t = useT();
  const [ctx, setCtx] = useState<PatientContext | null>(null);
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [ctxR, callsR] = await Promise.all([
        fetch(`/api/desk/patient-context/${contactId}`, { cache: "no-store" }),
        fetch(`/api/desk/contact-calls/${contactId}?limit=10`, { cache: "no-store" }),
      ]);
      if (ctxR.ok) {
        const j = (await ctxR.json()) as { context: PatientContext | null };
        setCtx(j.context);
        setNoteDraft(j.context?.notes?.free ?? "");
      }
      if (callsR.ok) {
        const j = (await callsR.json()) as { calls: CallSummary[] };
        setCalls(j.calls ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveNote() {
    setSavingNote(true);
    setNoteSaved(false);
    try {
      const r = await fetch(`/api/desk/patient-note/${contactId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: noteDraft }),
      });
      if (r.ok) {
        setNoteSaved(true);
        setTimeout(() => setNoteSaved(false), 2000);
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", justifyContent: "flex-end", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)", background: "var(--panel)",
          borderLeft: "1px solid var(--border)", overflow: "auto",
          padding: 20, display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{ctx?.identity?.nom ?? displayName ?? t("Fiche patient")}</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {e164 ?? ""}
              {headline && <span style={{ marginLeft: 10, fontSize: 11 }} className="tag">{headline}</span>}
            </div>
          </div>
          <button className="ghost" onClick={onClose} style={{ padding: "4px 10px", fontSize: 16 }}>×</button>
        </div>

        {err && (
          <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", fontSize: 13 }}>{err}</div>
        )}

        {loading ? (
          <div className="muted">{t("Chargement…")}</div>
        ) : ctx ? (
          <>
            <Section title={t("Identité")}>
              <Field label={t("Email")} value={ctx.identity?.email} />
              <Field label={t("Date de naissance")} value={ctx.identity?.dob} />
              <Field label={t("Qualification")} value={ctx.funnel?.qualification} />
              <Field label={t("Phase")} value={ctx.funnel?.current_phase} />
              <Field label={t("Cycle status")} value={ctx.funnel?.cycle_status} />
              <Field label={t("Nb appels")} value={ctx.funnel?.call_count} />
              <Field label={t("Dernier appel")} value={ctx.funnel?.last_call} />
              <Field label={t("Source")} value={ctx.source?.source_lead} />
            </Section>

            <Section title={t("Clinique")}>
              <Field label="BMI" value={ctx.clinical?.bmi} />
              <Field label={t("Poids")} value={ctx.clinical?.poids ? `${ctx.clinical.poids} kg` : null} />
              <Field label={t("Taille")} value={ctx.clinical?.taille ? `${ctx.clinical.taille} cm` : null} />
              <Field label={t("Allergies")} value={ctx.clinical?.allergies} long />
              <Field label={t("Traitements en cours")} value={ctx.clinical?.current_medications} long />
              <Field label={t("Antécédents chirurgicaux")} value={ctx.clinical?.past_surgeries} long />
              <Field label={t("Autres conditions chroniques")} value={ctx.clinical?.other_chronic_conditions} long />
            </Section>

            <Section title={t("NHS")}>
              <Field label={t("Statut WMP")} value={ctx.nhs?.wmp_status} />
              <Field label={t("Détails WMP")} value={ctx.nhs?.wmp_details} long />
              <Field label={t("Statut documents")} value={ctx.nhs?.document_status} />
              <Field label={t("Documents reçus")} value={ctx.nhs?.received_documents} long />
              <Field label={t("Documents manquants")} value={ctx.nhs?.missing_documents} long />
            </Section>

            <Section title={t("Notes")}>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={5}
                style={{ width: "100%", resize: "vertical", fontSize: 13, fontFamily: "inherit" }}
                placeholder={t("Ajouter une note…")}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={saveNote} disabled={savingNote || noteDraft === (ctx.notes?.free ?? "")}>
                  {savingNote ? t("Enregistrement…") : t("Enregistrer la note")}
                </button>
                {noteSaved && <span style={{ color: "var(--good)", fontSize: 12 }}>{t("✓ Note enregistrée")}</span>}
              </div>
            </Section>
          </>
        ) : (
          <div className="muted" style={{ padding: 16, fontSize: 13 }}>
            {t("Aucune fiche patient liée à ce contact. Tu peux quand même prendre des notes ci-dessous.")}
            <Section title={t("Notes")}>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={5}
                style={{ width: "100%", resize: "vertical", fontSize: 13, fontFamily: "inherit", marginTop: 8 }}
                placeholder={t("Ajouter une note…")}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <button onClick={saveNote} disabled={savingNote}>
                  {savingNote ? t("Enregistrement…") : t("Enregistrer la note")}
                </button>
                {noteSaved && <span style={{ color: "var(--good)", fontSize: 12 }}>{t("✓ Note enregistrée")}</span>}
              </div>
            </Section>
          </div>
        )}

        <Section title={t("Derniers appels")}>
          {calls.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t("Aucun appel récent.")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {calls.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr auto auto",
                    gap: 10, padding: 8, fontSize: 12,
                    border: "1px solid var(--border)", borderRadius: 6,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontVariantNumeric: "tabular-nums" }}>
                      {new Date(c.started_at).toLocaleString()}
                    </div>
                    {c.summary && (
                      <div className="muted" style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.summary}
                      </div>
                    )}
                  </div>
                  <div className="muted">{c.direction === "in" ? "↘" : "↗"} {c.duration_secs ?? 0}s</div>
                  {c.qualification && <span className="tag" style={{ fontSize: 10 }}>{c.qualification}</span>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, long }: { label: string; value: string | number | null | undefined; long?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: long ? "block" : "grid", gridTemplateColumns: long ? undefined : "180px 1fr", gap: 6, fontSize: 13, alignItems: "baseline" }}>
      <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ whiteSpace: long ? "pre-wrap" : "normal" }}>{String(value)}</span>
    </div>
  );
}
