"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  agent_kind: string | null;
  recording_url: string | null;
  transcript_url: string | null;
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
type AgentFilter = "all" | "ai" | "human";

const REFRESH_MS = 5000;

export function SuperviseInboundClient() {
  const t = useT();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    if (filter === "live") {
      if (c.state !== "ringing" && c.state !== "in_progress") return false;
    } else if (filter === "answered") {
      if (c.answered_at === null) return false;
    } else if (filter === "missed") {
      if (c.answered_at || (c.state !== "ended" && c.state !== "failed")) return false;
    }
    if (agentFilter === "ai" && c.agent_kind !== "ai") return false;
    if (agentFilter === "human" && c.agent_kind !== "human") return false;
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

      {/* Filter row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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

        <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />

        {(["all", "ai", "human"] as AgentFilter[]).map((f) => {
          const labels: Record<AgentFilter, string> = {
            all: t("Tous les agents"),
            ai: t("Agent IA"),
            human: t("Agent humain"),
          };
          return (
            <button
              key={f}
              onClick={() => setAgentFilter(f)}
              className={f === agentFilter ? "" : "ghost"}
              style={{ padding: "6px 14px", fontSize: 13, borderRadius: 999 }}
            >
              {labels[f]}
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
                <Th>{t("Agent")}</Th>
                <Th>{t("Qualification")}</Th>
                <Th>{t("Durée")}</Th>
              </tr>
            </thead>
            <tbody>
              {visibleCalls.map((c, i) => (
                <>
                  <CallRow
                    key={c.id}
                    call={c}
                    odd={i % 2 === 1}
                    expanded={expandedId === c.id}
                    onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  />
                  {expandedId === c.id && (
                    <tr key={`${c.id}-detail`}>
                      <td colSpan={6} style={{ padding: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
                        <CallDetail call={c} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CallRow({ call, odd, expanded, onToggle }: { call: InboundCall; odd: boolean; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  const isLive = call.state === "ringing" || call.state === "in_progress";

  return (
    <tr
      onClick={onToggle}
      style={{
        background: expanded
          ? "color-mix(in srgb, var(--accent) 8%, var(--bg-2))"
          : isLive
            ? "color-mix(in srgb, var(--good) 8%, transparent)"
            : odd
              ? "var(--bg-2)"
              : "transparent",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
    >
      {/* Heure */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>
        <div>{formatTime(call.started_at)}</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>{formatDate(call.started_at)}</div>
      </td>

      {/* De (numéro + contact cliquable) */}
      <td style={{ padding: "10px 12px" }} onClick={(e) => e.stopPropagation()}>
        {call.contact_id ? (
          <Link
            href={`/contacts/${call.contact_id}`}
            style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
          >
            {call.contact_name || call.from_e164 || "—"}
          </Link>
        ) : (
          <span style={{ fontWeight: 500 }}>{call.contact_name || call.from_e164 || "—"}</span>
        )}
        {call.contact_name && call.from_e164 && call.from_e164 !== call.contact_e164 && (
          <div className="muted" style={{ fontSize: 11 }}>{call.from_e164}</div>
        )}
        {call.contact_name && call.contact_e164 && !call.from_e164 && (
          <div className="muted" style={{ fontSize: 11 }}>{call.contact_e164}</div>
        )}
      </td>

      {/* État */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
        <StateBadge state={call.state} disposition={call.disposition} answeredAt={call.answered_at} />
      </td>

      {/* Agent */}
      <td style={{ padding: "10px 12px", color: "var(--text)", fontSize: 13 }}>
        {call.agent_name ? (
          <div>
            <span>{call.agent_name}</span>
            {call.agent_kind === "ai" && (
              <span style={{ marginLeft: 5, fontSize: 10, color: "var(--muted)", background: "var(--bg-2)", borderRadius: 4, padding: "1px 5px" }}>IA</span>
            )}
          </div>
        ) : call.agent_kind === "ai" ? (
          <span className="muted" style={{ fontSize: 12 }}>{t("IA")}</span>
        ) : call.answered_at ? (
          <span className="muted" style={{ fontSize: 12 }}>{t("IA")}</span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
        )}
      </td>

      {/* Qualification */}
      <td style={{ padding: "10px 12px" }}>
        {call.qualification ? (
          <QualBadge qual={call.qualification} />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
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

interface TranscriptTurn {
  seq: number;
  speaker: string;
  text: string;
  started_at: string | null;
}

function CallDetail({ call }: { call: InboundCall }) {
  const t = useT();
  const [transcript, setTranscript] = useState<TranscriptTurn[] | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    if (!call.transcript_url && !call.recording_url) {
      // Still try to fetch transcript from API in case it's stored in DB.
    }
    setTranscriptLoading(true);
    fetch(`/api/calls/${call.id}/transcripts`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TranscriptTurn[]) => setTranscript(rows))
      .catch(() => setTranscript([]))
      .finally(() => setTranscriptLoading(false));
  }, [call.id, call.transcript_url, call.recording_url]);

  const callerLabel = call.contact_name || call.from_e164 || t("Appelant");

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      {/* Header + link to full detail page */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {callerLabel}
          {call.from_e164 && call.contact_name && (
            <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>{call.from_e164}</span>
          )}
        </div>
        <Link
          href={`/calls/${call.id}`}
          style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", padding: "4px 10px", border: "1px solid var(--accent)", borderRadius: 6 }}
          onClick={(e) => e.stopPropagation()}
        >
          {t("Voir le détail →")}
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Audio player */}
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6, fontWeight: 600 }}>
            {t("Enregistrement")}
          </div>
          {call.recording_url ? (
            <audio
              controls
              src={`/api/dashboard/call-recording?id=${call.id}`}
              style={{ width: "100%", height: 36 }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>{t("Aucun enregistrement disponible")}</div>
          )}
        </div>

        {/* Call meta */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {call.agent_name && (
            <MetaItem label={t("Agent")} value={`${call.agent_name}${call.agent_kind === "ai" ? " (IA)" : ""}`} />
          )}
          {call.qualification && (
            <MetaItem label={t("Qualification")} value={QUAL_LABELS[call.qualification] ?? call.qualification} />
          )}
          {call.duration_secs != null && (
            <MetaItem label={t("Durée")} value={formatMMSS(call.duration_secs)} />
          )}
        </div>
      </div>

      {/* Transcript */}
      <div>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, fontWeight: 600 }}>
          {t("Transcription")}
        </div>
        {transcriptLoading ? (
          <div className="muted" style={{ fontSize: 12 }}>{t("Chargement…")}</div>
        ) : !transcript || transcript.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{t("Aucune transcription disponible")}</div>
        ) : (
          <div style={{ display: "grid", gap: 6, maxHeight: 240, overflowY: "auto" }}>
            {transcript.map((turn) => {
              const isAgent = turn.speaker === "agent" || turn.speaker === "assistant";
              return (
                <div key={turn.seq} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: isAgent ? "var(--accent)" : "var(--good)",
                      whiteSpace: "nowrap",
                      marginTop: 2,
                      minWidth: 60,
                      textAlign: "right",
                    }}
                  >
                    {isAgent ? (call.agent_name || t("Agent")) : callerLabel}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text)" }}>{turn.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
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
