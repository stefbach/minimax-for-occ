"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

interface CalendarTask {
  id: string;
  contact: { id: string | null; display_name: string | null; e164: string | null };
  qualification: string | null;
  transfer_reason: string | null;
  scheduled_for: string;
  status: string;
  notes: string | null;
  original_call_id: string | null;
}

/**
 * Human agent's personal calendar of upcoming callbacks.
 *
 * Reads /api/desk/tasks?scope=mine&lookahead_days=30 (assignments only,
 * grouped by day), so an agent sees what's scheduled across the next
 * month without scrolling through everyone else's load.
 */
export function MyCalendarClient() {
  const t = useT();
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number>(30);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/desk/tasks?scope=mine&lookahead_days=${horizon}`, { cache: "no-store" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { mine: CalendarTask[] };
      setTasks(j.mine ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [horizon]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Group by local-day so an agent in BST sees "Mardi 17 juin" instead
  // of UTC midnight boundaries. Sorted asc within each day.
  const groups = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks) {
      const d = new Date(task.scheduled_for);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const arr = map.get(key) ?? [];
      arr.push(task);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        key,
        date: new Date(items[0].scheduled_for),
        items: items.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
      }));
  }, [tasks]);

  const overdue = useMemo(
    () => tasks.filter((t) => Date.parse(t.scheduled_for) < Date.now()),
    [tasks],
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <span className="muted">{t("Horizon")}</span>
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            <option value={7}>{t("7 prochains jours")}</option>
            <option value={14}>{t("14 prochains jours")}</option>
            <option value={30}>{t("30 prochains jours")}</option>
            <option value={90}>{t("3 prochains mois")}</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 18, marginLeft: "auto" }}>
          <Kpi label={t("À traiter")} value={tasks.length} />
          <Kpi label={t("En retard")} value={overdue.length} accent={overdue.length > 0 ? "var(--bad)" : undefined} />
        </div>
        <button className="ghost" onClick={refresh}>{t("Rafraîchir")}</button>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", fontSize: 13 }}>{err}</div>
      )}

      {loading && tasks.length === 0 ? (
        <div className="card muted">{t("Chargement…")}</div>
      ) : groups.length === 0 ? (
        <div className="card muted" style={{ textAlign: "center", padding: 24 }}>
          {t("Aucun rappel programmé. Va sur Mon poste pour gérer les leads à traiter.")}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-2)",
                display: "flex",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <strong style={{ fontSize: 14 }}>{formatDayHeader(g.date)}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {g.items.length} {g.items.length > 1 ? t("rappels") : t("rappel")}
              </span>
            </div>
            <div>
              {g.items.map((task) => {
                const overdueRow = Date.parse(task.scheduled_for) < Date.now();
                return (
                  <div
                    key={task.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "84px 1fr auto",
                      gap: 12,
                      padding: "10px 14px",
                      borderTop: "1px solid var(--border)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: overdueRow ? "var(--bad)" : "inherit" }}>
                      {formatHHmm(task.scheduled_for)}
                      {overdueRow && (
                        <div style={{ fontSize: 10, color: "var(--bad)", textTransform: "uppercase" }}>
                          {t("En retard")}
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {task.contact.display_name ?? "—"}
                        {task.contact.e164 && (
                          <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                            {task.contact.e164}
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.qualification && <span className="tag" style={{ fontSize: 10, marginRight: 6 }}>{task.qualification}</span>}
                        {task.notes ?? task.transfer_reason ?? ""}
                      </div>
                    </div>
                    <Link
                      href={`/desk?task=${task.id}`}
                      className="ghost"
                      style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, textDecoration: "none", color: "var(--text)" }}
                    >
                      {t("Ouvrir")} →
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600, color: accent ?? "inherit" }}>{value}</span>
    </div>
  );
}

function formatDayHeader(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const taskDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((taskDay - today) / 86400000);
  const label = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  if (delta === 0) return `Aujourd'hui — ${label}`;
  if (delta === 1) return `Demain — ${label}`;
  if (delta === -1) return `Hier — ${label}`;
  return label;
}

function formatHHmm(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
