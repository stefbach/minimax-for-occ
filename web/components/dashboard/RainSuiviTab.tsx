"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import {
  UserRound, RefreshCw, ClipboardList, Building2,
  CheckCircle2, Clock, Sparkles, AlertTriangle, XCircle, MicOff, X, FileBarChart, ChevronDown, ChevronUp,
} from "lucide-react";
import type { RainSuiviResponse, RainPatient, NhsPatient, RainMissionStats } from "@/app/api/dashboard/rain-suivi/route";
import type { RainCallDetail, RainAiReview } from "@/app/api/dashboard/rain-call-detail/route";
import type { RainDailyReportResponse, DailyReportCall } from "@/app/api/dashboard/rain-daily-report/route";

type MissionTab = "humain" | "rappels" | "suivis" | "nhs";

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MissionCard({
  label,
  icon,
  stats,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  stats: RainMissionStats;
  active: boolean;
  onClick: () => void;
}) {
  const pct = stats.pct;
  const color = pct === 100 ? "var(--good)" : pct >= 50 ? "var(--accent)" : "var(--bad)";
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        padding: "14px 16px",
        cursor: "pointer",
        border: active ? `2px solid ${color}` : "2px solid transparent",
        transition: "border-color 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>{icon} {label}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        {stats.called}/{stats.total} contactés
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function CallStatus({ called, duration, disposition }: { called: boolean; duration: number | null; disposition: string | null }) {
  if (called) {
    return (
      <div>
        <span className="tag good" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <CheckCircle2 size={13} /> Appelé
        </span>
        {disposition && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{disposition}</div>}
        {duration ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtDuration(duration)}</div> : null}
      </div>
    );
  }
  return (
    <span className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bad-bg,#fef2f2)", color: "var(--bad)" }}>
      <Clock size={13} /> En attente
    </span>
  );
}

function PatientNameButton({ nom, onClick }: { nom: string | null; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ghost"
      style={{
        padding: 0, border: "none", background: "none", fontWeight: 600,
        color: "var(--text)", textDecoration: "underline", textDecorationColor: "var(--border-2)",
        textUnderlineOffset: 3, cursor: "pointer", textAlign: "left",
      }}
    >
      {nom ?? "—"}
    </button>
  );
}

function LeadRow({ p, onSelect }: { p: RainPatient; onSelect: (p: RainPatient) => void }) {
  return (
    <tr>
      <td><PatientNameButton nom={p.nom} onClick={() => onSelect(p)} /></td>
      <td>
        {p.numero_telephone ? (
          <a href={`tel:${p.numero_telephone}`} style={{ color: "var(--accent-2)" }}>{p.numero_telephone}</a>
        ) : "—"}
      </td>
      <td style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(p.last_qualification_update)}</td>
      <td style={{ textAlign: "center" }}>{p.call_count ?? 0}</td>
      <td>
        <CallStatus called={p.called_today} duration={p.call_duration_secs} disposition={p.call_disposition} />
      </td>
      <td style={{ color: "var(--muted)", fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.note ?? "—"}
      </td>
    </tr>
  );
}

function NhsRow({ p, onSelect }: { p: NhsPatient; onSelect: (p: NhsPatient) => void }) {
  const pct = p.dossier_completion_pct ?? 0;
  return (
    <tr>
      <td><PatientNameButton nom={p.nom} onClick={() => onSelect(p)} /></td>
      <td>
        {p.numero_telephone ? (
          <a href={`tel:${p.numero_telephone}`} style={{ color: "var(--accent-2)" }}>{p.numero_telephone}</a>
        ) : "—"}
      </td>
      <td>
        <span style={{ fontSize: 12, color: pct >= 80 ? "var(--good)" : pct >= 40 ? "var(--accent)" : "var(--bad)" }}>
          {p.dossier_status ?? "—"}
        </span>
      </td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 60, height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: pct >= 80 ? "var(--good)" : "var(--accent)" }} />
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{pct}%</span>
        </div>
      </td>
      <td style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(p.last_call_datetime)}</td>
      <td>
        <CallStatus called={p.called_today} duration={p.call_duration_secs} disposition={p.call_disposition} />
      </td>
    </tr>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftIso(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(iso: string): string {
  if (iso === todayIso()) return "Aujourd'hui";
  if (iso === yesterdayIso()) return "Hier";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function CalendarGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="3" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" />
      <line x1="16" y1="2.5" x2="16" y2="6.5" />
    </svg>
  );
}

function ChevronGlyph({ dir }: { dir: "left" | "right" }) {
  const d = dir === "left" ? "M14 6l-6 6 6 6" : "M10 6l6 6-6 6";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function rangeLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  const t = new Date(`${to}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  return `${f} → ${t}`;
}

export type DateRange = { from: string; to: string };

function DateNavigator({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(value.from);
  const [draftTo, setDraftTo] = useState(value.to);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isSingleDay = value.from === value.to;
  const isToday = isSingleDay && value.from === todayIso();
  const isYesterday = isSingleDay && value.from === yesterdayIso();
  const isCustom = !isToday && !isYesterday;

  useEffect(() => {
    if (!pickerOpen) return;
    setDraftFrom(value.from);
    setDraftTo(value.to);
    function onOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  function applyDraft() {
    const from = draftFrom <= draftTo ? draftFrom : draftTo;
    const to = draftFrom <= draftTo ? draftTo : draftFrom;
    onChange({ from, to: to > todayIso() ? todayIso() : to });
    setPickerOpen(false);
  }

  function setSingleDay(iso: string) {
    onChange({ from: iso, to: iso });
    setPickerOpen(false);
  }

  function shiftSingleDay(deltaDays: number) {
    if (!isSingleDay) return;
    const iso = shiftIso(value.from, deltaDays);
    onChange({ from: iso, to: iso });
  }

  const label = isToday ? "Aujourd'hui" : isYesterday ? "Hier" : isSingleDay ? dateLabel(value.from) : rangeLabel(value.from, value.to);

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: 3,
          borderRadius: 11,
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
        }}
      >
        <button
          aria-label="Jour précédent"
          onClick={() => shiftSingleDay(-1)}
          disabled={!isSingleDay}
          style={{
            display: "grid", placeItems: "center", width: 30, height: 30, padding: 0,
            borderRadius: 8, background: "transparent", border: "none",
            color: isSingleDay ? "var(--muted)" : "var(--border-2)",
            cursor: isSingleDay ? "pointer" : "default",
          }}
          className="ghost"
        >
          <ChevronGlyph dir="left" />
        </button>

        <div style={{ display: "flex", gap: 2, padding: "0 2px" }}>
          {(["today", "yesterday"] as const).map((k) => {
            const iso = k === "today" ? todayIso() : yesterdayIso();
            const active = k === "today" ? isToday : isYesterday;
            return (
              <button
                key={k}
                onClick={() => setSingleDay(iso)}
                style={{
                  padding: "6px 13px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#1a0d05" : "var(--text)",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
              >
                {k === "today" ? "Aujourd'hui" : "Hier"}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 20, background: "var(--border-2)", margin: "0 2px" }} />

        <button
          onClick={() => setPickerOpen((v) => !v)}
          title="Choisir une date ou une plage"
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "6px 12px 6px 10px", fontSize: 13,
            fontWeight: isCustom ? 600 : 500,
            borderRadius: 8, border: "none",
            background: isCustom ? "var(--accent-soft)" : "transparent",
            color: isCustom ? "var(--accent-2)" : "var(--muted)",
          }}
        >
          <CalendarGlyph />
          <span>{isCustom ? label : "Choisir…"}</span>
        </button>

        <button
          aria-label="Jour suivant"
          onClick={() => shiftSingleDay(1)}
          disabled={!isSingleDay || isToday}
          style={{
            display: "grid", placeItems: "center", width: 30, height: 30, padding: 0,
            borderRadius: 8, background: "transparent", border: "none",
            color: (!isSingleDay || isToday) ? "var(--border-2)" : "var(--muted)",
            cursor: (!isSingleDay || isToday) ? "default" : "pointer",
          }}
          className="ghost"
        >
          <ChevronGlyph dir="right" />
        </button>
      </div>

      {pickerOpen && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50,
            background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12,
            padding: 16, width: 260, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Choisir une plage
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            Du
            <input
              type="date"
              value={draftFrom}
              max={todayIso()}
              onChange={(e) => setDraftFrom(e.target.value)}
              style={{
                padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-2)",
                background: "var(--panel-2)", color: "var(--text)", fontSize: 13,
                colorScheme: "dark",
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            Au
            <input
              type="date"
              value={draftTo}
              max={todayIso()}
              onChange={(e) => setDraftTo(e.target.value)}
              style={{
                padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-2)",
                background: "var(--panel-2)", color: "var(--text)", fontSize: 13,
                colorScheme: "dark",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button onClick={() => setPickerOpen(false)} className="ghost" style={{ flex: 1, padding: "7px 0", fontSize: 13 }}>
              Annuler
            </button>
            <button onClick={applyDraft} style={{ flex: 1, padding: "7px 0", fontSize: 13 }}>
              Appliquer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const RATING_STYLE: Record<NonNullable<RainAiReview["rating"]>, { label: string; color: string; icon: ReactNode }> = {
  bon: { label: "Bon appel", color: "var(--good)", icon: <CheckCircle2 size={16} /> },
  moyen: { label: "Moyen", color: "var(--accent)", icon: <AlertTriangle size={16} /> },
  insuffisant: { label: "Insuffisant", color: "var(--bad)", icon: <XCircle size={16} /> },
};

function PatientDetailPanel({
  patient,
  onClose,
}: {
  patient: RainPatient | NhsPatient;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<RainCallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const phone = (patient.numero_telephone ?? "").replace(/\s/g, "");
  const lastCallId = "last_call_id" in patient ? patient.last_call_id : null;

  const load = useCallback(() => {
    if (!lastCallId && !phone) {
      setDetail({ call_id: null, started_at: null, duration_secs: null, disposition: null, has_recording: false, ai_review: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = lastCallId ? `call_id=${encodeURIComponent(lastCallId)}` : `phone=${encodeURIComponent(phone)}`;
    fetch(`/api/dashboard/rain-call-detail?${qs}`)
      .then((r) => r.json())
      .then((j: RainCallDetail) => setDetail(j))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [phone, lastCallId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function runAnalysis() {
    if (!detail?.call_id) return;
    setAnalyzing(true);
    setAnalysisError(null);
    fetch("/api/dashboard/rain-call-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call_id: detail.call_id }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; ai_review?: RainAiReview; error?: string; message?: string }) => {
        if (j.ok && j.ai_review) {
          setDetail((d) => (d ? { ...d, ai_review: j.ai_review! } : d));
        } else {
          setAnalysisError(j.message ?? j.error ?? "Analyse impossible.");
        }
      })
      .catch((e: unknown) => setAnalysisError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setAnalyzing(false));
  }

  const rating = detail?.ai_review?.rating;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(6,8,13,0.6)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 100vw)",
          height: "100%",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border)",
          overflowY: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{patient.nom ?? "—"}</div>
            {patient.numero_telephone && (
              <a href={`tel:${patient.numero_telephone}`} style={{ color: "var(--accent-2)", fontSize: 13 }}>
                {patient.numero_telephone}
              </a>
            )}
          </div>
          <button onClick={onClose} className="ghost" style={{ display: "grid", placeItems: "center", padding: "4px 8px" }}>
            <X size={15} />
          </button>
        </div>

        {loading ? (
          <div className="card muted" style={{ padding: 20, textAlign: "center" }}>Chargement…</div>
        ) : !detail?.call_id ? (
          <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
            Aucun appel de Rain trouvé pour ce patient.
          </div>
        ) : (
          <>
            {/* Last call summary */}
            <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>Dernier appel</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{fmtDate(detail.started_at)}</span>
                <span style={{ color: "var(--muted)" }}>{detail.duration_secs ? fmtDuration(detail.duration_secs) : "—"}</span>
              </div>
              {detail.disposition && (
                <span className="tag" style={{ width: "fit-content", background: "var(--panel-2)", color: "var(--text)" }}>
                  {detail.disposition}
                </span>
              )}
            </div>

            {/* Audio player */}
            {detail.has_recording && detail.call_id ? (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Enregistrement
                </div>
                <audio controls style={{ width: "100%" }} src={`/api/dashboard/call-recording?id=${encodeURIComponent(detail.call_id)}`} />
              </div>
            ) : (
              <div className="card" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 14, fontSize: 12.5, color: "var(--muted)" }}>
                <MicOff size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Pas d'enregistrement disponible pour cet appel (l'enregistrement automatique a été activé récemment — les appels à venir seront capturés).</span>
              </div>
            )}

            {/* AI review */}
            {detail.ai_review ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rating && (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, color: RATING_STYLE[rating].color }}>
                    {RATING_STYLE[rating].icon} {RATING_STYLE[rating].label}
                  </div>
                )}
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Résumé de l'appel
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{detail.ai_review.summary}</div>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Analyse critique — prestation de Rain
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{detail.ai_review.critique}</div>
                </div>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--muted)" }}>Voir la transcription complète</summary>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)", whiteSpace: "pre-wrap", marginTop: 8 }}>
                    {detail.ai_review.transcript}
                  </div>
                </details>
              </div>
            ) : detail.has_recording ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={runAnalysis} disabled={analyzing} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 16px" }}>
                  {analyzing ? "Analyse en cours… (peut prendre 1 min)" : <><Sparkles size={15} /> Générer transcription + analyse IA</>}
                </button>
                {analysisError && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--bad)" }}>
                    <AlertTriangle size={13} /> {analysisError}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const RATING_DOT: Record<string, string> = {
  bon: "var(--good)",
  moyen: "var(--accent)",
  insuffisant: "var(--bad)",
};

function DailyReportCallRow({ c }: { c: DailyReportCall }) {
  const color = c.ai_review?.rating ? RATING_DOT[c.ai_review.rating] : "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.nom ?? c.numero_telephone ?? "—"}</div>
        {c.ai_review ? (
          <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.ai_review.summary}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {c.status === "no_recording" ? "Pas d'enregistrement" : c.status === "failed" ? `Échec analyse : ${c.error_message ?? ""}` : "Pas encore analysé"}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{fmtDate(c.started_at)}</div>
    </div>
  );
}

function DailyReportSection({ date }: { date: string }) {
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<RainDailyReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQuick = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/rain-daily-report?date=${date}`)
      .then((r) => r.json())
      .then((j: RainDailyReportResponse & { error?: string }) => {
        if (j.error) setError(j.error);
        else setReport(j);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { if (expanded && !report) loadQuick(); }, [expanded, report, loadQuick]);
  useEffect(() => { setReport(null); }, [date]);

  function generateFull() {
    setGenerating(true);
    setError(null);
    fetch("/api/dashboard/rain-daily-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date }),
    })
      .then((r) => r.json())
      .then((j: RainDailyReportResponse & { error?: string }) => {
        if (j.error) setError(j.error);
        else setReport(j);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setGenerating(false));
  }

  const pendingCt = report?.calls.filter((c) => c.status === "skipped").length ?? 0;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="ghost"
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderRadius: 0, border: "none", background: "transparent",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
          <FileBarChart size={17} /> Rapport de fin de journée
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {loading ? (
            <div className="muted" style={{ padding: 12 }}>Chargement…</div>
          ) : error ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--bad)", fontSize: 13 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          ) : report ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{report.total_calls}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Appels répondus</div>
                </div>
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--good)" }}>{report.analyzed}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Analysés</div>
                </div>
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--good)" }}>{report.ratings.bon}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Bons</div>
                </div>
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>{report.ratings.moyen}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Moyens</div>
                </div>
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--bad)" }}>{report.ratings.insuffisant}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Insuffisants</div>
                </div>
              </div>

              {report.synthesis && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Verdict global</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{report.synthesis.overall_verdict}</div>
                  </div>
                  <div className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Points forts</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{report.synthesis.strengths}</div>
                  </div>
                  <div className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Points à améliorer</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{report.synthesis.improvements}</div>
                  </div>
                </div>
              )}

              {pendingCt > 0 && (
                <button onClick={generateFull} disabled={generating} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 16px" }}>
                  <Sparkles size={15} />
                  {generating ? `Analyse en cours… (peut prendre plusieurs minutes)` : `Analyser les ${pendingCt} appel(s) restant(s)`}
                </button>
              )}

              <details>
                <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--muted)" }}>
                  Voir le détail par appel ({report.calls.length})
                </summary>
                <div style={{ marginTop: 8 }}>
                  {report.calls.map((c) => <DailyReportCallRow key={c.call_id} c={c} />)}
                </div>
              </details>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function RainSuiviTab({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<RainSuiviResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MissionTab>("humain");
  const [filter, setFilter] = useState<"all" | "done" | "pending">("all");
  const [dateRange, setDateRange] = useState<DateRange>({ from: todayIso(), to: todayIso() });
  const [selectedPatient, setSelectedPatient] = useState<RainPatient | NhsPatient | null>(null);

  const load = useCallback((range: DateRange) => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/rain-suivi?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((j: RainSuiviResponse & { error?: string }) => {
        if (j.error) { setError(j.error); setData(null); }
        else setData(j);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(dateRange); }, [load, refreshKey, dateRange]);

  const ms = data?.mission_stats;
  const stats = data?.stats;

  const TABS: { id: MissionTab; label: string; icon: ReactNode }[] = [
    { id: "humain", label: "À l'humain", icon: <UserRound size={14} /> },
    { id: "rappels", label: "Rappels", icon: <RefreshCw size={14} /> },
    { id: "suivis", label: "Suivis", icon: <ClipboardList size={14} /> },
    { id: "nhs", label: "NHS manquants", icon: <Building2 size={14} /> },
  ];

  function getList(): (RainPatient | NhsPatient)[] {
    if (!data) return [];
    const map: Record<MissionTab, (RainPatient | NhsPatient)[]> = {
      humain: data.humain,
      rappels: data.rappels,
      suivis: data.suivis,
      nhs: data.nhs,
    };
    return map[activeTab];
  }

  const rawList = getList();
  const visible = rawList.filter((p) => {
    if (filter === "done") return p.called_today;
    if (filter === "pending") return !p.called_today;
    return true;
  });

  const doneCt = rawList.filter((p) => p.called_today).length;
  const pendingCt = rawList.length - doneCt;
  const statusColLabel = dateRange.from !== dateRange.to
    ? "Statut sur la période"
    : dateRange.from === todayIso()
      ? "Statut aujourd'hui"
      : "Statut ce jour";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, display: "flex", alignItems: "center", gap: 9 }}>
            <UserRound size={19} /> Suivi activité — Rain
          </h2>
          {data?.generated_at && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Actualisé à {new Date(data.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              {" — "}
              {dateRange.from === dateRange.to
                ? <>Données du {new Date(`${dateRange.from}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</>
                : <>Données du {new Date(`${dateRange.from}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })} au {new Date(`${dateRange.to}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <DateNavigator value={dateRange} onChange={setDateRange} />
          <button
            onClick={() => load(dateRange)}
            disabled={loading}
            title="Actualiser"
            style={{ display: "grid", placeItems: "center", width: 38, height: 38, padding: 0, borderRadius: 10 }}
          >
            <span style={{ display: "grid", placeItems: "center", animation: loading ? "rain-spin 0.8s linear infinite" : "none" }}>
              <RefreshCw size={16} />
            </span>
          </button>
        </div>
      </div>
      <style>{`@keyframes rain-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {error && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--bad)", padding: 14 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Overall KPIs */}
      {ms && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: ms.overall.pct === 100 ? "var(--good)" : ms.overall.pct >= 50 ? "var(--accent)" : "var(--bad)" }}>{ms.overall.pct}%</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Complétion globale</div>
          </div>
          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--good)" }}>{ms.overall.called}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Patients contactés</div>
          </div>
          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{ms.overall.total}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Total missions</div>
          </div>
          {stats && (
            <>
              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.total_today}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Appels passés</div>
              </div>
              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--good)" }}>{stats.answered_today}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Répondus (&gt;10s)</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Overall progress bar */}
      {ms && ms.overall.total > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            Progression globale — {ms.overall.called}/{ms.overall.total} missions complétées
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${ms.overall.pct}%`,
                background: ms.overall.pct === 100 ? "var(--good)" : "var(--accent)",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Mission cards — clickable to switch list */}
      {ms && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {TABS.map((t) => (
            <MissionCard
              key={t.id}
              label={t.label}
              icon={t.icon}
              stats={ms[t.id]}
              active={activeTab === t.id}
              onClick={() => { setActiveTab(t.id); setFilter("all"); }}
            />
          ))}
        </div>
      )}

      {/* Active list */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {TABS.find((t) => t.id === activeTab)?.icon}{" "}
            {TABS.find((t) => t.id === activeTab)?.label}
            {rawList.length > 0 && (
              <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6, fontSize: 13 }}>
                ({rawList.length} patients)
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "done", "pending"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "" : "ghost"}
                onClick={() => setFilter(f)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", fontSize: 12 }}
              >
                {f === "all" ? `Tous (${rawList.length})` : f === "done" ? <><CheckCircle2 size={12} /> {doneCt}</> : <><Clock size={12} /> {pendingCt}</>}
              </button>
            ))}
          </div>
        </div>

        {loading && !data ? (
          <div className="card muted" style={{ padding: 24, textAlign: "center" }}>Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24, textAlign: "center", color: "var(--muted)" }}>
            {filter === "pending" ? (<><CheckCircle2 size={20} /> Tous les patients de cette liste ont été contactés !</>) : "Aucun patient dans cette liste."}
          </div>
        ) : activeTab === "nhs" ? (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="list">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Téléphone</th>
                  <th>Statut dossier</th>
                  <th>Complété</th>
                  <th>Dernier contact</th>
                  <th>{statusColLabel}</th>
                </tr>
              </thead>
              <tbody>
                {(visible as NhsPatient[]).map((p) => <NhsRow key={p.id} p={p} onSelect={setSelectedPatient} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="list">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Téléphone</th>
                  <th>Mis à jour le</th>
                  <th>Nb appels</th>
                  <th>{statusColLabel}</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {(visible as RainPatient[]).map((p) => <LeadRow key={p.id} p={p} onSelect={setSelectedPatient} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dateRange.from === dateRange.to && <DailyReportSection date={dateRange.from} />}

      {selectedPatient && (
        <PatientDetailPanel patient={selectedPatient} onClose={() => setSelectedPatient(null)} />
      )}
    </div>
  );
}
