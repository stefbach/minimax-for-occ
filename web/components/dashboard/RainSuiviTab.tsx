"use client";

import { useEffect, useState, useCallback } from "react";
import type { RainSuiviResponse, RainPatient } from "@/app/api/dashboard/rain-suivi/route";

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

export function RainSuiviTab({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<RainSuiviResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "done" | "pending">("all");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/dashboard/rain-suivi")
      .then((r) => r.json())
      .then((j: RainSuiviResponse & { error?: string }) => {
        if (j.error) { setError(j.error); setData(null); }
        else setData(j);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const patients: RainPatient[] = data?.patients ?? [];
  const stats = data?.stats;

  const visible = patients.filter((p) => {
    if (filter === "done") return p.called_today;
    if (filter === "pending") return !p.called_today;
    return true;
  });

  const doneCt = patients.filter((p) => p.called_today).length;
  const pendingCt = patients.filter((p) => !p.called_today).length;
  const completionPct = patients.length > 0 ? Math.round((doneCt / patients.length) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Suivi activité — Rain</h2>
          {data?.generated_at && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Actualisé à {new Date(data.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
        <button onClick={load} disabled={loading} style={{ padding: "6px 14px" }}>
          {loading ? "Chargement…" : "↻ Actualiser"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ color: "var(--bad)", padding: 14 }}>⚠️ {error}</div>
      )}

      {/* KPI tiles */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <KpiTile label="À appeler (total)" value={patients.length} />
          <KpiTile label="Appelés aujourd'hui" value={doneCt} color="var(--good)" />
          <KpiTile label="Pas encore appelés" value={pendingCt} color={pendingCt > 0 ? "var(--bad)" : undefined} />
          <KpiTile label="Complétion" value={`${completionPct}%`} />
          <KpiTile label="Appels passés" value={stats.total_today} />
          <KpiTile label="Appels répondus" value={stats.answered_today} />
          {stats.duration_total_secs > 0 && (
            <KpiTile label="Temps total" value={fmtDuration(stats.duration_total_secs)} />
          )}
        </div>
      )}

      {/* Progress bar */}
      {patients.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            Progression du jour — {doneCt}/{patients.length} patients contactés
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${completionPct}%`,
                background: completionPct === 100 ? "var(--good)" : "var(--accent)",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8 }}>
        {(["all", "done", "pending"] as const).map((f) => (
          <button
            key={f}
            className={filter === f ? "" : "ghost"}
            onClick={() => setFilter(f)}
            style={{ padding: "5px 14px", fontSize: 13 }}
          >
            {f === "all" ? `Tous (${patients.length})` : f === "done" ? `✅ Appelés (${doneCt})` : `⏳ En attente (${pendingCt})`}
          </button>
        ))}
      </div>

      {/* Patient list */}
      {loading && !data ? (
        <div className="card muted" style={{ padding: 24, textAlign: "center" }}>Chargement…</div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          {filter === "pending" ? "✅ Tous les patients ont été contactés aujourd'hui !" : "Aucun patient à afficher."}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Téléphone</th>
                <th>Qualifié le</th>
                <th>Nb appels</th>
                <th>Statut aujourd'hui</th>
                <th>Durée</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <PatientRow key={p.id} patient={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PatientRow({ patient: p }: { patient: RainPatient }) {
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{p.nom ?? "—"}</td>
      <td>
        {p.numero_telephone ? (
          <a href={`tel:${p.numero_telephone}`} style={{ color: "var(--accent-2)" }}>
            {p.numero_telephone}
          </a>
        ) : "—"}
      </td>
      <td style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(p.last_qualification_update)}</td>
      <td style={{ textAlign: "center" }}>{p.call_count ?? 0}</td>
      <td>
        {p.called_today ? (
          <span className="tag good">✅ Appelé</span>
        ) : (
          <span className="tag" style={{ background: "var(--bad-bg, #fef2f2)", color: "var(--bad)" }}>⏳ En attente</span>
        )}
        {p.call_disposition && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.call_disposition}</div>
        )}
      </td>
      <td style={{ color: "var(--muted)", fontSize: 12 }}>
        {p.call_duration_secs ? fmtDuration(p.call_duration_secs) : "—"}
      </td>
      <td style={{ color: "var(--muted)", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.note ?? "—"}
      </td>
    </tr>
  );
}

function KpiTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
