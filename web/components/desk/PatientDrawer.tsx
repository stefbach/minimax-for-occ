"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

interface Props {
  /** Contact id when known. Desk tasks from the auto-qualifier have none —
   *  in that case the drawer loads the patient by phone (e164) instead. */
  contactId?: string | null;
  /** Display name shown in the header until the lead row loads. */
  displayName?: string | null;
  /** Phone shown in the header until the lead row loads. Also used as the
   *  lookup key when contactId is absent. */
  e164?: string | null;
  onClose: () => void;
  /** Optional headline (e.g. the task qualification chip) shown in the header. */
  headline?: string;
}

interface ColumnSpec {
  key: string;
  label: string;
  type: string;
}

interface PatientRowResponse {
  table_label: string | null;
  physical_table: string | null;
  row_id: string | null;
  row: Record<string, unknown> | null;
  columns: ColumnSpec[];
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

const LONG_TEXT_KEYS = new Set([
  "note", "notes", "call_1_note", "call_2_note", "call_3_note",
  "raison_ne_pas_rappeler", "call_outcome", "call_error",
  "nhs_wmp_details", "received_documents", "missing_documents",
  "other_chronic_conditions", "past_surgeries", "current_medications",
  "allergies", "anesthesia_allergies",
]);

// Column groups shown as sections; everything else goes in 'Autres champs'.
const SECTIONS: Array<{ title: string; cols: string[] }> = [
  { title: "Identité", cols: ["nom", "email", "patient_dob", "numero_telephone"] },
  { title: "Suivi", cols: ["qualification", "current_phase", "cycle_status", "rappel_rdv", "next_call_at", "do_not_call", "voicemail_detected", "call_count", "last_call_datetime", "last_qualification_update"] },
  { title: "Clinique", cols: ["bmi", "poids", "taille", "allergies", "anesthesia_allergies", "current_medications", "past_surgeries", "other_chronic_conditions"] },
  { title: "NHS / Documents", cols: ["nhs_wmp_status", "nhs_wmp_details", "document_status", "received_documents", "missing_documents"] },
  { title: "Cadence", cols: ["date_j1", "date_j3", "date_j5", "j1_attempts", "j3_attempts", "j5_attempts"] },
  { title: "Notes & Source", cols: ["note", "call_1_note", "call_2_note", "call_3_note", "raison_ne_pas_rappeler", "source_lead", "form_facebook"] },
];

/**
 * CRM-style patient drawer (Wati June 10 v4): loads the FULL leads_rdv
 * row + all column definitions, renders every column grouped in
 * meaningful sections, lets the agent edit any field including
 * rappel_rdv. Save sends a single PATCH per click.
 */
export function PatientDrawer({ contactId, displayName, e164, onClose, headline }: Props) {
  const t = useT();
  const [data, setData] = useState<PatientRowResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // Tasks created by the auto-qualifier have no contact_id — load the
      // leads_rdv row by phone instead. The calls list is keyed on contact_id,
      // so it's only fetched when we have one (the row's call_*_note fields
      // still surface recent call context either way).
      const rowSeg = contactId ?? "by-phone";
      const e164q = e164 ? `?e164=${encodeURIComponent(e164)}` : "";
      const [rowR, callsR] = await Promise.all([
        fetch(`/api/desk/patient-row/${rowSeg}${e164q}`, { cache: "no-store" }),
        contactId
          ? fetch(`/api/desk/contact-calls/${contactId}?limit=10`, { cache: "no-store" })
          : Promise.resolve(null),
      ]);
      if (rowR.ok) {
        const j = (await rowR.json()) as PatientRowResponse;
        setData(j);
        const initial: Record<string, string> = {};
        for (const [k, v] of Object.entries(j.row ?? {})) {
          initial[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        }
        setDraft(initial);
      } else {
        const j = (await rowR.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${rowR.status}`);
      }
      if (callsR && callsR.ok) {
        const j = (await callsR.json()) as { calls: CallSummary[] };
        setCalls(j.calls ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contactId, e164]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setField(k: string, v: string) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setErr(null);
    try {
      // Only send fields whose value actually changed vs the loaded row.
      const original = data.row ?? {};
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(draft)) {
        const o = original[k];
        const oStr = o == null ? "" : typeof o === "object" ? JSON.stringify(o) : String(o);
        if (v !== oStr) values[k] = v;
      }
      if (Object.keys(values).length === 0) {
        setSaving(false);
        return;
      }
      const rowSeg = contactId ?? "by-phone";
      const e164q = e164 ? `?e164=${encodeURIComponent(e164)}` : "";
      const r = await fetch(`/api/desk/patient-row/${rowSeg}${e164q}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
        return;
      }
      setSavedAt(Date.now());
      // Refresh local data after save.
      if ("row" in j && j.row) {
        setData((d) => (d ? { ...d, row: (j as { row: Record<string, unknown> }).row } : d));
      }
    } finally {
      setSaving(false);
    }
  }

  const allCols = data?.columns ?? [];
  const colsByKey = new Map(allCols.map((c) => [c.key, c]));
  const usedKeys = new Set(SECTIONS.flatMap((s) => s.cols));
  // Any column declared on the table but not in our known SECTIONS goes here.
  const otherCols = allCols
    .map((c) => c.key)
    .filter((k) => !usedKeys.has(k) && k !== "id" && k !== "created_at");

  function inputType(c: ColumnSpec): string {
    if (c.key === "rappel_rdv" || c.key === "next_call_at" || c.key === "last_call_datetime" || c.key === "last_qualification_update") return "datetime-local";
    if (c.key.startsWith("date_") || c.type === "date") return "date";
    if (c.type === "number") return "number";
    if (c.type === "email" || c.key === "email") return "email";
    if (c.type === "phone" || c.key.includes("telephone") || c.key === "phone") return "tel";
    return "text";
  }

  function isLong(c: ColumnSpec): boolean {
    if (c.type === "text" && (LONG_TEXT_KEYS.has(c.key) || c.key.endsWith("_note"))) return true;
    return false;
  }

  function renderInput(c: ColumnSpec) {
    const long = isLong(c);
    const v = draft[c.key] ?? "";
    if (c.key === "do_not_call" || c.key === "voicemail_detected") {
      const checked = v === "true" || v === "1";
      return (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setField(c.key, e.target.checked ? "true" : "false")}
        />
      );
    }
    if (long) {
      return (
        <textarea
          value={v}
          onChange={(e) => setField(c.key, e.target.value)}
          rows={4}
          style={{ width: "100%", resize: "vertical", fontSize: 13, fontFamily: "inherit" }}
        />
      );
    }
    // datetime-local needs a specific format
    let val = v;
    const it = inputType(c);
    if ((it === "datetime-local" || it === "date") && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        if (it === "date") {
          val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        } else {
          val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        }
      }
    }
    return (
      <input
        type={it}
        value={val}
        onChange={(e) => setField(c.key, e.target.value)}
        style={{ width: "100%", fontSize: 13 }}
      />
    );
  }

  const headerName = (data?.row?.nom as string | undefined) ?? displayName ?? t("Fiche patient");
  const headerPhone = (data?.row?.numero_telephone as string | undefined) ?? e164 ?? "";

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
          width: "min(820px, 100%)", background: "var(--panel)",
          borderLeft: "1px solid var(--border)", overflow: "auto",
          padding: 20, display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, position: "sticky", top: -20, background: "var(--panel)", zIndex: 1, paddingTop: 8, paddingBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{headerName}</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {headerPhone}
              {headline && <span style={{ marginLeft: 10, fontSize: 11 }} className="tag">{headline}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={saving || loading}>
              {saving ? t("Enregistrement…") : t("Enregistrer")}
            </button>
            <button className="ghost" onClick={onClose} disabled={saving} style={{ padding: "4px 10px", fontSize: 16 }}>×</button>
          </div>
        </div>
        {savedAt && Date.now() - savedAt < 3000 && (
          <div style={{ color: "var(--good)", fontSize: 12, textAlign: "right" }}>{t("✓ Enregistré")}</div>
        )}

        {err && (
          <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", fontSize: 13 }}>{err}</div>
        )}

        {loading ? (
          <div className="muted">{t("Chargement…")}</div>
        ) : data?.row ? (
          <>
            {SECTIONS.map((s) => {
              const cols = s.cols
                .map((k) => colsByKey.get(k))
                .filter((c): c is ColumnSpec => !!c);
              if (cols.length === 0) return null;
              return (
                <Section key={s.title} title={t(s.title)}>
                  <Grid cols={cols} renderInput={renderInput} isLong={isLong} />
                </Section>
              );
            })}
            {otherCols.length > 0 && (
              <Section title={t("Autres champs")}>
                <Grid
                  cols={otherCols.map((k) => colsByKey.get(k)!).filter(Boolean)}
                  renderInput={renderInput}
                  isLong={isLong}
                />
              </Section>
            )}
          </>
        ) : (
          <div className="card muted" style={{ padding: 16 }}>
            {t("Aucune fiche dans la table leads_rdv pour ce contact.")}
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

function Grid({
  cols, renderInput, isLong,
}: {
  cols: ColumnSpec[];
  renderInput: (c: ColumnSpec) => React.ReactNode;
  isLong: (c: ColumnSpec) => boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      {cols.map((c) => (
        <div key={c.key} style={isLong(c) ? { gridColumn: "1 / -1" } : undefined}>
          <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 4 }}>
            {c.label}
          </label>
          {renderInput(c)}
        </div>
      ))}
    </div>
  );
}
