"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RainSuiviResponse, RainPatient, NhsPatient, RainMissionStats } from "@/app/api/dashboard/rain-suivi/route";

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
  icon: string;
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
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{icon} {label}</span>
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
        <span className="tag good">✅ Appelé</span>
        {disposition && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{disposition}</div>}
        {duration ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtDuration(duration)}</div> : null}
      </div>
    );
  }
  return <span className="tag" style={{ background: "var(--bad-bg,#fef2f2)", color: "var(--bad)" }}>⏳ En attente</span>;
}

function LeadRow({ p }: { p: RainPatient }) {
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{p.nom ?? "—"}</td>
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

function NhsRow({ p }: { p: NhsPatient }) {
  const pct = p.dossier_completion_pct ?? 0;
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{p.nom ?? "—"}</td>
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

function DateNavigator({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const isToday = value === todayIso();
  const isYesterday = value === yesterdayIso();

  function openPicker() {
    const el = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      el.showPicker();
    } else {
      el.focus();
    }
  }

  return (
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
        onClick={() => onChange(shiftIso(value, -1))}
        style={{
          display: "grid",
          placeItems: "center",
          width: 30,
          height: 30,
          padding: 0,
          borderRadius: 8,
          background: "transparent",
          border: "none",
          color: "var(--muted)",
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
              onClick={() => onChange(iso)}
              style={{
                padding: "6px 13px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: "none",
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
        onClick={openPicker}
        title="Choisir une date"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 12px 6px 10px",
          fontSize: 13,
          fontWeight: !isToday && !isYesterday ? 600 : 500,
          borderRadius: 8,
          border: "none",
          background: !isToday && !isYesterday ? "var(--accent-soft)" : "transparent",
          color: !isToday && !isYesterday ? "var(--accent-2)" : "var(--muted)",
        }}
      >
        <CalendarGlyph />
        <span>{!isToday && !isYesterday ? dateLabel(value) : "Choisir…"}</span>
        <input
          ref={dateInputRef}
          type="date"
          value={value}
          max={todayIso()}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            border: "none",
            cursor: "pointer",
          }}
        />
      </button>

      <button
        aria-label="Jour suivant"
        onClick={() => onChange(shiftIso(value, 1))}
        disabled={isToday}
        style={{
          display: "grid",
          placeItems: "center",
          width: 30,
          height: 30,
          padding: 0,
          borderRadius: 8,
          background: "transparent",
          border: "none",
          color: isToday ? "var(--border-2)" : "var(--muted)",
          cursor: isToday ? "default" : "pointer",
        }}
        className="ghost"
      >
        <ChevronGlyph dir="right" />
      </button>
    </div>
  );
}

export function RainSuiviTab({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<RainSuiviResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MissionTab>("humain");
  const [filter, setFilter] = useState<"all" | "done" | "pending">("all");
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());

  const load = useCallback((date: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/rain-suivi?date=${date}`)
      .then((r) => r.json())
      .then((j: RainSuiviResponse & { error?: string }) => {
        if (j.error) { setError(j.error); setData(null); }
        else setData(j);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(selectedDate); }, [load, refreshKey, selectedDate]);

  const ms = data?.mission_stats;
  const stats = data?.stats;

  const TABS: { id: MissionTab; label: string; icon: string }[] = [
    { id: "humain", label: "À l'humain", icon: "👤" },
    { id: "rappels", label: "Rappels", icon: "🔁" },
    { id: "suivis", label: "Suivis", icon: "📋" },
    { id: "nhs", label: "NHS manquants", icon: "🏥" },
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Suivi activité — Rain 👩</h2>
          {data?.generated_at && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Actualisé à {new Date(data.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              {" — "}Données du {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <DateNavigator value={selectedDate} onChange={setSelectedDate} />
          <button
            onClick={() => load(selectedDate)}
            disabled={loading}
            title="Actualiser"
            style={{ display: "grid", placeItems: "center", width: 38, height: 38, padding: 0, borderRadius: 10 }}
          >
            <span style={{ display: "inline-block", transformOrigin: "center", animation: loading ? "rain-spin 0.8s linear infinite" : "none" }}>
              ↻
            </span>
          </button>
        </div>
      </div>
      <style>{`@keyframes rain-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {error && (
        <div className="card" style={{ color: "var(--bad)", padding: 14 }}>⚠️ {error}</div>
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
                style={{ padding: "4px 12px", fontSize: 12 }}
              >
                {f === "all" ? `Tous (${rawList.length})` : f === "done" ? `✅ (${doneCt})` : `⏳ (${pendingCt})`}
              </button>
            ))}
          </div>
        </div>

        {loading && !data ? (
          <div className="card muted" style={{ padding: 24, textAlign: "center" }}>Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            {filter === "pending" ? "✅ Tous les patients de cette liste ont été contactés !" : "Aucun patient dans cette liste."}
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
                  <th>Statut aujourd'hui</th>
                </tr>
              </thead>
              <tbody>
                {(visible as NhsPatient[]).map((p) => <NhsRow key={p.id} p={p} />)}
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
                  <th>Statut aujourd'hui</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {(visible as RainPatient[]).map((p) => <LeadRow key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
