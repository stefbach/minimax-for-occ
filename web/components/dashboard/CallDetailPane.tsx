"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import type { DrillCall } from "@/app/api/dashboard/calls-drill/route";
import type { CallDetailResponse } from "@/app/api/dashboard/call-detail/route";

// Detail view shown INSIDE the drill-down panel when a row is clicked. Renders
// the recording (audio player), the LLM summary and the transcript — for both
// native Axon calls and Retell-synced calls. The header is built from the row
// data we already have, so it paints instantly while the extra data loads.

const QUAL_TONE: Record<QualBucket, string> = {
  rdv_confirme: "var(--good)",
  passer_humain: "var(--good)",
  rappel: "var(--accent)",
  pas_interesse: "var(--bad)",
  pas_de_reponse: "var(--warn)",
  repondeur: "var(--warn)",
  faux_numero: "var(--bad)",
  non_eligible: "var(--bad)",
  ne_pas_rappeler: "var(--bad)",
  autre: "var(--muted)",
};

function fmtDur(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function qualLabel(q: QualBucket): string {
  return QUAL_BUCKETS.find((b) => b.key === q)?.label ?? q;
}

export function CallDetailPane({
  call,
  leadsSource,
  onBack,
}: {
  call: DrillCall;
  leadsSource: "prod" | "test";
  onBack: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<CallDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null); setDetail(null);
    const qs = new URLSearchParams({ id: call.id, leads_source: leadsSource });
    fetch(`/api/dashboard/call-detail?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) setDetail(j as CallDetailResponse);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [call.id, leadsSource]);

  const tone = QUAL_TONE[call.qualification];
  const title = call.contact_name ?? call.phone ?? t("Inconnu");

  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 5,
        background: "var(--bg)", display: "flex", flexDirection: "column",
        animation: "drill-detail-in 200ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {/* Header with Back */}
      <div style={{ height: 3, background: tone }} />
      <div
        style={{
          padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="ghost"
          style={{ padding: "5px 11px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          ← {t("Retour")}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </div>
          {call.contact_name && call.phone && (
            <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{call.phone}</div>
          )}
        </div>
        <span
          style={{
            fontSize: 10, padding: "3px 7px", borderRadius: 4, whiteSpace: "nowrap",
            background: `color-mix(in srgb, ${tone} 14%, transparent)`,
            color: tone, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3,
          }}
        >
          {qualLabel(call.qualification)}
        </span>
      </div>

      {/* Meta line */}
      <div
        className="muted"
        style={{
          padding: "8px 16px", fontSize: 12, display: "flex", gap: 10,
          flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--border)",
        }}
      >
        <span>{call.direction === "in" ? `↘ ${t("Entrant")}` : `↗ ${t("Sortant")}`}</span>
        <span>·</span>
        <span>{fmtDateTime(call.started_at)}</span>
        <span>·</span>
        <span>{fmtDur(call.duration_secs)}</span>
        <span>·</span>
        <span style={{ color: call.answered ? "var(--good)" : "var(--muted)", fontWeight: 600 }}>
          {call.answered ? t("Décroché") : t("Non décroché")}
        </span>
        {call.agent_name && (<><span>·</span><span>{call.agent_name}</span></>)}
      </div>

      {/* Scrollable body: recording, summary, transcript */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "grid", gap: 16 }}>
        {/* Recording */}
        <section>
          <h4 style={{ margin: "0 0 6px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" }}>
            {t("Enregistrement")}
          </h4>
          {detail?.recording_url ? (
            <div style={{ display: "grid", gap: 6 }}>
              {/* Stream through our own origin (see /api/dashboard/call-recording)
                  so playback works regardless of the upstream host's CORS /
                  content-type. */}
              <audio controls preload="metadata" src={`/api/dashboard/call-recording?id=${encodeURIComponent(call.id)}`} style={{ width: "100%" }} />
              <a
                href={`/api/dashboard/call-recording?id=${encodeURIComponent(call.id)}`}
                target="_blank"
                rel="noreferrer"
                className="muted"
                style={{ fontSize: 11, justifySelf: "start" }}
              >
                {t("Ouvrir l'enregistrement dans un onglet")} ↗
              </a>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              {loading ? t("Chargement…") : t("Aucun enregistrement disponible.")}
            </div>
          )}
        </section>

        {/* Summary */}
        {(detail?.summary || loading) && (
          <section>
            <h4 style={{ margin: "0 0 6px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" }}>
              {t("Résumé")}
            </h4>
            {detail?.summary ? (
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{detail.summary}</p>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>{loading ? t("Chargement…") : "—"}</div>
            )}
          </section>
        )}

        {/* Transcript */}
        <section>
          <h4 style={{ margin: "0 0 6px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" }}>
            {t("Transcript")}
          </h4>
          {loading && (
            <div style={{ display: "grid", gap: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ height: 40, borderRadius: 8, background: "color-mix(in srgb, var(--muted) 14%, transparent)", animation: "drill-pulse 1.2s ease-in-out infinite" }} />
              ))}
            </div>
          )}
          {err && <div style={{ fontSize: 12, color: "var(--bad)" }}>{err}</div>}
          {!loading && !err && detail && detail.transcript.length === 0 && (
            <div className="muted" style={{ fontSize: 12 }}>{t("Transcript indisponible pour cet appel.")}</div>
          )}
          {detail && detail.transcript.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {detail.transcript.map((turn, i) => {
                const isAgent = turn.speaker === "agent";
                return (
                  <div
                    key={i}
                    style={{
                      justifySelf: isAgent ? "start" : "end",
                      maxWidth: "85%",
                      padding: "7px 11px", borderRadius: 10, fontSize: 13, lineHeight: 1.45,
                      background: isAgent
                        ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                        : "color-mix(in srgb, var(--muted) 14%, transparent)",
                      borderTopLeftRadius: isAgent ? 2 : 10,
                      borderTopRightRadius: isAgent ? 10 : 2,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.3, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{isAgent ? t("Agent") : t("Client")}</span>
                      {typeof turn.t === "number" && (
                        <span style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 0 }}>
                          {Math.floor(turn.t / 60)}:{String(turn.t % 60).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                    {turn.text}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <style jsx>{`
        @keyframes drill-detail-in { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes drill-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
      `}</style>
    </div>
  );
}
