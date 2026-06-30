"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

// Calendrier de l'agent IA (Charlotte) — les rappels qu'elle doit passer à
// l'heure demandée par le patient. Lecture seule : reflet de ce que le dialer
// va composer (leads_rdv en qualification=RAPPEL avec une heure rappel_rdv).
//
// Les heures sont affichées en heure UK (Europe/London) : c'est l'heure du
// patient, celle qu'il a demandée et à laquelle Charlotte appellera.
interface AiCallback {
  id: string;
  name: string | null;
  e164: string | null;
  scheduled_for: string;
}

interface AgentRow {
  user_id: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
}

const UK_TZ = "Europe/London";

export function IaCalendarClient() {
  const t = useT();
  const lang = useLang();
  const [rows, setRows] = useState<AiCallback[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null); // id of row being rescheduled/cancelled
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const rescheduleRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  type FilterMode = "today" | "tomorrow" | "h7" | "h30" | "all";
  const [filterMode, setFilterMode] = useState<FilterMode>("h7");

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/desk/ai-callbacks`, { cache: "no-store" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { callbacks: AiCallback[] };
      setRows(j.callbacks ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Agents for the "Confier à un agent" picker (same source as Supervision).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/desk/agents", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { agents: AgentRow[] };
        if (alive) setAgents(j.agents ?? []);
      } catch {
        /* picker just stays empty */
      }
    })();
    return () => { alive = false; };
  }, []);

  const cancelCallback = useCallback(async (row: AiCallback) => {
    if (!confirm(t("Annuler ce rappel IA ? Le lead reviendra dans la cadence normale."))) return;
    setActing(row.id);
    setErr(null);
    try {
      const r = await fetch("/api/desk/ai-callbacks/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164: row.e164, action: "cancel" }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }, [refresh, t]);

  const submitReschedule = useCallback(async (row: AiCallback) => {
    if (!rescheduleDate || !rescheduleTime) return;
    setActing(row.id);
    setErr(null);
    try {
      const r = await fetch("/api/desk/ai-callbacks/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164: row.e164, action: "reschedule", date: rescheduleDate, time: rescheduleTime }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRescheduleId(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }, [rescheduleDate, rescheduleTime, refresh]);

  // Confier un rappel à un humain : crée une tâche assignée + retire le lead de
  // la file de Charlotte (il disparaît du calendrier IA au refresh).
  const assign = useCallback(async (row: AiCallback, userId: string | null) => {
    setAssigning(row.id);
    setErr(null);
    try {
      const r = await fetch("/api/desk/ai-callbacks/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164: row.e164, name: row.name, scheduled_for: row.scheduled_for, user_id: userId }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAssigning(null);
    }
  }, [refresh]);

  // Filter by UK-day so the buckets line up with the patient's local day.
  const filtered = useMemo(() => {
    if (filterMode === "all") return rows;
    const todayUk = ukDayKey(new Date());
    if (filterMode === "today") return rows.filter((r) => ukDayKey(new Date(r.scheduled_for)) === todayUk);
    if (filterMode === "tomorrow") {
      const tmrw = new Date(Date.now() + 86400000);
      const k = ukDayKey(tmrw);
      return rows.filter((r) => ukDayKey(new Date(r.scheduled_for)) === k);
    }
    const horizonDays = filterMode === "h7" ? 7 : 30;
    const now = Date.now();
    const horizon = now + horizonDays * 86400000;
    return rows.filter((r) => {
      const ts = Date.parse(r.scheduled_for);
      // include past-due (not yet called) + everything up to the horizon
      return ts < horizon;
    });
  }, [rows, filterMode]);

  const overdue = useMemo(
    () => filtered.filter((r) => Date.parse(r.scheduled_for) < Date.now()),
    [filtered],
  );

  // Group by UK calendar day.
  const groups = useMemo(() => {
    const map = new Map<string, AiCallback[]>();
    for (const r of filtered) {
      const key = ukDayKey(new Date(r.scheduled_for));
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        key,
        items: items.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
      }));
  }, [filtered]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="page-header">
        <div>
          <h1>{t("Calendrier IA")}</h1>
          <div className="subtitle">{t("Les rappels que Charlotte (IA) passera à l'heure demandée par le patient.")}</div>
        </div>
        <HelpButton contextKey="mon-calendrier.ia" />
      </div>
      <div className="card" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div role="group" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <FilterTab active={filterMode === "today"} onClick={() => setFilterMode("today")}>{t("Aujourd'hui")}</FilterTab>
          <FilterTab active={filterMode === "tomorrow"} onClick={() => setFilterMode("tomorrow")}>{t("Demain")}</FilterTab>
          <FilterTab active={filterMode === "h7"} onClick={() => setFilterMode("h7")}>{t("7 prochains jours")}</FilterTab>
          <FilterTab active={filterMode === "h30"} onClick={() => setFilterMode("h30")}>{t("30 prochains jours")}</FilterTab>
          <FilterTab active={filterMode === "all"} onClick={() => setFilterMode("all")}>{t("Tous")}</FilterTab>
        </div>
        <div style={{ display: "flex", gap: 18, marginLeft: "auto" }}>
          <Kpi label={t("Rappels IA")} value={filtered.length} />
          <Kpi label={t("En retard")} value={overdue.length} accent={overdue.length > 0 ? "var(--bad)" : undefined} />
        </div>
        <button className="ghost" onClick={refresh}>{t("Rafraîchir")}</button>
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        🤖 {t("Rappels que Charlotte (IA) passera à l'heure demandée par le patient. Heures affichées en heure UK.")}
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", fontSize: 13 }}>{err}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="card muted">{t("Chargement…")}</div>
      ) : groups.length === 0 ? (
        <div className="card muted" style={{ textAlign: "center", padding: 24 }}>
          {t("Aucun rappel programmé pour l'IA. Quand un patient demande à être rappelé à une heure précise, le rappel apparaîtra ici.")}
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
              <strong style={{ fontSize: 14 }}>{formatUkDayHeader(g.key, lang)}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {g.items.length} {g.items.length > 1 ? t("rappels") : t("rappel")}
              </span>
            </div>
            <div>
              {g.items.map((r) => {
                const overdueRow = Date.parse(r.scheduled_for) < Date.now();
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "92px 1fr auto",
                      gap: 12,
                      padding: "10px 14px",
                      borderTop: "1px solid var(--border)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: overdueRow ? "var(--bad)" : "inherit" }}>
                      {formatUkTime(r.scheduled_for)}
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>UK</div>
                      {overdueRow && (
                        <div style={{ fontSize: 10, color: "var(--bad)", textTransform: "uppercase" }}>
                          {t("En retard")}
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {r.name ?? "—"}
                        {r.e164 && (
                          <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>
                            {r.e164}
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        <span className="tag" style={{ fontSize: 10 }}>🤖 {t("Rappel Charlotte")}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {/* Reprogrammer */}
                      {rescheduleId === r.id ? (
                        <div ref={rescheduleRef} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="date"
                            value={rescheduleDate}
                            onChange={(e) => setRescheduleDate(e.target.value)}
                            style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                          />
                          <input
                            type="time"
                            value={rescheduleTime}
                            min="08:00"
                            max="21:00"
                            onChange={(e) => setRescheduleTime(e.target.value)}
                            style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                          />
                          <button
                            onClick={() => void submitReschedule(r)}
                            disabled={acting === r.id || !rescheduleDate || !rescheduleTime}
                            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
                          >
                            {acting === r.id ? t("Envoi…") : t("Confirmer")}
                          </button>
                          <button
                            className="ghost"
                            onClick={() => setRescheduleId(null)}
                            style={{ fontSize: 12, padding: "4px 8px" }}
                          >
                            {t("Annuler")}
                          </button>
                        </div>
                      ) : (
                        <button
                          className="ghost"
                          onClick={() => {
                            const d = new Date(r.scheduled_for);
                            setRescheduleDate(d.toLocaleDateString("en-CA", { timeZone: UK_TZ }));
                            setRescheduleTime(d.toLocaleTimeString("fr-FR", { timeZone: UK_TZ, hour: "2-digit", minute: "2-digit", hour12: false }));
                            setRescheduleId(r.id);
                          }}
                          disabled={acting === r.id}
                          title={t("Modifier la date/heure du rappel")}
                          style={{ fontSize: 12, padding: "4px 8px" }}
                        >
                          ✏️ {t("Reprogrammer")}
                        </button>
                      )}

                      {/* Annuler le rappel IA */}
                      {rescheduleId !== r.id && (
                        <button
                          className="ghost"
                          onClick={() => void cancelCallback(r)}
                          disabled={acting === r.id}
                          title={t("Annuler ce rappel — le lead revient en cadence normale")}
                          style={{ fontSize: 12, padding: "4px 8px", color: "var(--bad)" }}
                        >
                          {acting === r.id ? t("…") : `✕ ${t("Annuler rappel")}`}
                        </button>
                      )}

                      {/* Confier ce rappel à un humain plutôt que Charlotte. */}
                      {rescheduleId !== r.id && (
                        <select
                          value=""
                          disabled={assigning === r.id}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            void assign(r, v === "__pool__" ? null : v);
                          }}
                          title={t("Confier ce rappel à un agent humain")}
                          style={{ fontSize: 12, padding: "5px 8px", maxWidth: 180, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                        >
                          <option value="">{assigning === r.id ? t("Envoi…") : `👤 ${t("Confier à un agent")}`}</option>
                          <option value="__pool__">{t("Pool (non assigné)")}</option>
                          {agents.filter((a) => a.is_active).map((a) => (
                            <option key={a.user_id} value={a.user_id}>{a.display_name}</option>
                          ))}
                        </select>
                      )}
                    </div>
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

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: import("react").ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={active ? "" : "ghost"}
      style={{ borderRadius: 0, borderRight: "1px solid var(--border)", padding: "6px 12px", fontSize: 13 }}
    >
      {children}
    </button>
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

// YYYY-MM-DD key for the UK calendar day of an instant.
function ukDayKey(d: Date): string {
  // en-CA yields YYYY-MM-DD; pin the timezone to Europe/London.
  return d.toLocaleDateString("en-CA", { timeZone: UK_TZ });
}
function formatUkTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleTimeString("fr-FR", { timeZone: UK_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}
function formatUkDayHeader(ymd: string, lang: "fr" | "en"): string {
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const todayUk = new Date().toLocaleDateString("en-CA", { timeZone: UK_TZ });
  const d = new Date(`${ymd}T12:00:00Z`);
  const label = d.toLocaleDateString(locale, { timeZone: UK_TZ, weekday: "long", day: "numeric", month: "long" });
  if (ymd === todayUk) return lang === "en" ? `Today — ${label}` : `Aujourd'hui — ${label}`;
  const tmrwUk = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: UK_TZ });
  if (ymd === tmrwUk) return lang === "en" ? `Tomorrow — ${label}` : `Demain — ${label}`;
  return label;
}
