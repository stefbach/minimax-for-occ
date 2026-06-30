"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

interface InboundCall {
  id: string;
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  qualification: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_e164: string | null;
  agent_name: string | null;
}

interface Kpis {
  total: number;
  answered: number;
  missed: number;
  in_progress: number;
  avg_duration_secs: number;
  answer_rate: number;
}

interface ApiResponse {
  calls: InboundCall[];
  kpis: Kpis | null;
  period: { from: string; to: string } | null;
}

type Filter = "all" | "live" | "answered" | "missed";

const REFRESH_MS = 5000;

export function SuperviseInboundClient() {
  const t = useT();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/supervise/inbound-calls", { cache: "no-store" });
      const j = (await r.json()) as ApiResponse & { error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setErr(null);
      setData(j);
      setLastRefresh(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const kpis = data?.kpis;
  const allCalls = data?.calls ?? [];

  const visibleCalls = allCalls.filter((c) => {
    if (filter === "live") return c.state === "ringing" || c.state === "in_progress";
    if (filter === "answered") return c.answered_at !== null;
    if (filter === "missed") return !c.answered_at && (c.state === "ended" || c.state === "failed");
    return true;
  });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* KPI row */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center", padding: 14 }}>
        <KpiStat label={t("Total aujourd'hui")} value={kpis?.total ?? "—"} />
        <KpiStat label={t("Décrochés")} value={kpis?.answered ?? "—"} tone="ok" />
        <KpiStat label={t("Manqués")} value={kpis?.missed ?? "—"} tone="bad" />
        <KpiStat label={t("En cours")} value={kpis?.in_progress ?? "—"} tone="warn" />
        <KpiStat label={t("Taux décroché")} value={kpis != null ? `${kpis.answer_rate}%` : "—"} tone={kpis && kpis.answer_rate >= 80 ? "ok" : kpis && kpis.answer_rate >= 50 ? "warn" : "bad"} />
        <KpiStat label={t("Durée moy.")} value={kpis?.avg_duration_secs ? formatMMSS(kpis.avg_duration_secs) : "—"} />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {lastRefresh && (
            <span className="muted" style={{ fontSize: 11 }}>
              {t("Mis à jour")} {lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button className="ghost" onClick={refresh} style={{ padding: "5px 10px", fontSize: 12 }}>
            ↻ {t("Rafraîchir")}
          </button>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)", padding: 12 }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["all", "live", "answered", "missed"] as Filter[]).map((f) => {
          const labels: Record<Filter, string> = {
            all: t("Tous"),
            live: t("En cours"),
            answered: t("Décrochés"),
            missed: t("Manqués"),
          };
          const counts: Record<Filter, number | null> = {
            all: kpis?.total ?? null,
            live: kpis?.in_progress ?? null,
            answered: kpis?.answered ?? null,
            missed: kpis?.missed ?? null,
          };
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={f === filter ? "" : "ghost"}
              style={{ padding: "6px 14px", fontSize: 13, borderRadius: 999 }}
            >
              {labels[f]}
              {counts[f] != null && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    background: f === filter ? "rgba(255,255,255,0.25)" : "var(--bg-2)",
                    borderRadius: 999,
                    padding: "1px 6px",
                  }}
                >
                  {counts[f]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {!data ? (
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          {t("Chargement…")}
        </div>
      ) : visibleCalls.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          {t("Aucun appel entrant pour cette période.")}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
                <Th>{t("Heure")}</Th>
                <Th>{t("De")}</Th>
                <Th>{t("État")}</Th>
                <Th>{t("Qualification")}</Th>
                <Th>{t("Agent")}</Th>
                <Th>{t("Durée")}</Th>
              </tr>
            </thead>
            <tbody>
              {visibleCalls.map((c, i) => (
                <CallRow key={c.id} call={c} odd={i % 2 === 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CallRow({ call, odd }: { call: InboundCall; odd: boolean }) {
  const t = useT();
  const isLive = call.state === "ringing" || call.state === "in_progress";

  return (
    <tr
      style={{
        background: isLive
          ? "color-mix(in srgb, var(--good) 8%, transparent)"
          : odd
            ? "var(--bg-2)"
            : "transparent",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Heure */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>
        <div>{formatTime(call.started_at)}</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>{formatDate(call.started_at)}</div>
      </td>

      {/* De (numéro + contact cliquable) */}
      <td style={{ padding: "10px 12px" }}>
        {call.contact_id ? (
          <Link
            href={`/contacts/${call.contact_id}`}
            style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
          >
            {call.contact_name || call.from_e164 || "—"}
          </Link>
        ) : (
          <span style={{ fontWeight: 500 }}>{call.from_e164 || "—"}</span>
        )}
        {call.contact_name && call.from_e164 && (
          <div className="muted" style={{ fontSize: 11 }}>{call.from_e164}</div>
        )}
      </td>

      {/* État */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
        <StateBadge state={call.state} disposition={call.disposition} answeredAt={call.answered_at} />
      </td>

      {/* Qualification */}
      <td style={{ padding: "10px 12px" }}>
        {call.qualification ? (
          <QualBadge qual={call.qualification} />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
        )}
      </td>

      {/* Agent */}
      <td style={{ padding: "10px 12px", color: "var(--text)", fontSize: 13 }}>
        {call.agent_name ? (
          <span>{call.agent_name}</span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            {call.answered_at ? t("IA") : "—"}
          </span>
        )}
      </td>

      {/* Durée */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {call.duration_secs != null ? (
          <span style={{ fontSize: 13 }}>{formatMMSS(call.duration_secs)}</span>
        ) : isLive ? (
          <LiveTimer startedAt={call.answered_at ?? call.started_at} />
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

function StateBadge({ state, disposition, answeredAt }: { state: string; disposition: string | null; answeredAt: string | null }) {
  const t = useT();
  let label: string;
  let color: string;

  if (state === "ringing") {
    label = t("Sonnerie");
    color = "var(--warn)";
  } else if (state === "in_progress") {
    label = t("En cours");
    color = "var(--good)";
  } else if (answeredAt) {
    label = t("Décroché");
    color = "var(--good)";
  } else if (disposition === "declined_by_human") {
    label = t("Décliné");
    color = "var(--bad)";
  } else if (disposition === "abandoned" || disposition === "no_answer") {
    label = t("Abandonné");
    color = "var(--muted)";
  } else {
    label = t("Manqué");
    color = "var(--muted)";
  }

  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        color,
        letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  );
}

const QUAL_LABELS: Record<string, string> = {
  rdv_confirme: "RDV confirmé",
  rdv_a_confirmer: "RDV à confirmer",
  rappel: "Rappel",
  pas_interesse: "Pas intéressé",
  echec: "Échec",
  no_answer: "Sans réponse",
  connected: "Contacté",
  voicemail: "Messagerie",
  invalide: "Invalide",
};

function QualBadge({ qual }: { qual: string }) {
  const label = QUAL_LABELS[qual] ?? qual;
  const isPositive = qual === "rdv_confirme" || qual === "rdv_a_confirmer" || qual === "connected";
  const isNeutral = qual === "rappel";
  const color = isPositive ? "var(--good)" : isNeutral ? "var(--warn)" : "var(--muted)";
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 7px",
        borderRadius: 4,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setSecs(Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span style={{ color: "var(--good)", fontWeight: 600 }}>
      {formatMMSS(secs)}
    </span>
  );
}

function KpiStat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "bad" | "warn" }) {
  const color =
    tone === "ok" ? "var(--good)" : tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--text)";
  return (
    <div style={{ textAlign: "center", minWidth: 70 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "9px 12px",
        textAlign: "left",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}
