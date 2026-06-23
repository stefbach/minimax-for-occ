"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { bucketForCall } from "@/lib/qualification";
import { matchesGlobalFilters, hasActiveGlobalFilters, DEFAULT_GLOBAL_FILTERS, type GlobalFilters } from "@/lib/global-filters";
import {
  buildReportData, generateCsv, reportFilename, downloadBlob,
  type ReportCall, type ReportFrequency, type ReportFormat,
} from "@/lib/report";
import { ReportViewer } from "@/components/reports/ReportViewer";
import type { ReportPayload } from "@/lib/reports/types";

// "Générer un rapport" — dropdown offering daily / weekly / monthly aggregation
// in PDF (rich server-side preview → window.print()) or CSV (client-side download).

type ExtFrequency = ReportFrequency | "monthly";

type Row = ReportCall & {
  answered_at: string | null;
  agent_handles?: { display_name: string | null } | null;
  contacts?: { display_name: string | null } | null;
  from_e164?: string | null;
  to_e164?: string | null;
  lead?: { name: string | null } | null;
};

const CHOICES: { freq: ExtFrequency; format: ReportFormat; labelFr: string; labelEn: string }[] = [
  { freq: "daily",   format: "pdf", labelFr: "Quotidien — PDF",     labelEn: "Daily — PDF" },
  { freq: "daily",   format: "csv", labelFr: "Quotidien — CSV",     labelEn: "Daily — CSV" },
  { freq: "weekly",  format: "pdf", labelFr: "Hebdomadaire — PDF",  labelEn: "Weekly — PDF" },
  { freq: "weekly",  format: "csv", labelFr: "Hebdomadaire — CSV",  labelEn: "Weekly — CSV" },
  { freq: "monthly", format: "pdf", labelFr: "Mensuel — PDF",       labelEn: "Monthly — PDF" },
  { freq: "monthly", format: "csv", labelFr: "Mensuel — CSV",       labelEn: "Monthly — CSV" },
];

function periodForFreq(freq: ExtFrequency): { from: string; to: string; label: string; type: "pilotage_hebdo" | "bilan_mensuel" } {
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  if (freq === "daily") {
    return {
      from: today.toISOString(),
      to: now.toISOString(),
      label: today.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
      type: "pilotage_hebdo",
    };
  }
  if (freq === "monthly") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return {
      from: from.toISOString(),
      to: now.toISOString(),
      label: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      type: "bilan_mensuel",
    };
  }
  // weekly
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 7);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    label: `${from.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })} – ${today.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}`,
    type: "pilotage_hebdo",
  };
}

export function ReportButton({
  from,
  to,
  periodLabel,
  direction,
  leadsSource,
  system,
  global = DEFAULT_GLOBAL_FILTERS,
}: {
  from: string;
  to: string;
  periodLabel: string;
  direction: string;
  leadsSource: "prod" | "test";
  system: "all" | "retell" | "axon";
  global?: GlobalFilters;
}) {
  const t = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportPayload | null>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Lock body scroll when preview is open
  useEffect(() => {
    if (preview) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [preview]);

  const runPdf = async (freq: ExtFrequency) => {
    if (ref.current) ref.current.open = false;
    setBusy(true);
    setErr(null);
    try {
      const p = periodForFreq(freq);
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: p.type, from: p.from, to: p.to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setPreview(j as ReportPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "report error");
    } finally {
      setBusy(false);
    }
  };

  const runCsv = async (freq: ReportFrequency) => {
    if (ref.current) ref.current.open = false;
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ state: "ended,failed", limit: "2000", from, to, leads_source: leadsSource, enrich: "lead" });
      if (direction !== "all") qs.set("direction", direction);
      if (system !== "all") qs.set("system", system);
      const r = await fetch(`/api/calls?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      let rows: Row[] = Array.isArray(j) ? j : [];
      if (hasActiveGlobalFilters(global)) {
        const evaluable = { ...global, attempt: "all" as const, eligibility: "all" as const, sources: [] };
        rows = rows.filter((c) =>
          matchesGlobalFilters(evaluable, {
            durationSecs: c.duration_secs ?? 0,
            bucket: bucketForCall(c),
            agent: c.agent_handles?.display_name ?? null,
            answered: !!c.answered_at,
            attempt: null,
            eligibility: "unknown",
            source: null,
            haystack: `${c.lead?.name ?? ""} ${c.contacts?.display_name ?? ""} ${c.from_e164 ?? ""} ${c.to_e164 ?? ""}`.toLowerCase(),
          }),
        );
      }
      const data = buildReportData({ calls: rows, periodLabel, frequency: freq });
      const blob = generateCsv(data, freq);
      downloadBlob(blob, reportFilename({ periodLabel, frequency: freq, format: "csv" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "report error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <details ref={ref} style={{ position: "relative", display: "inline-block" }}>
        <summary
          className="ghost"
          style={{
            listStyle: "none", cursor: busy ? "wait" : "pointer", userSelect: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", fontSize: 14, whiteSpace: "nowrap",
            border: "1px solid var(--border)", borderRadius: 8,
            opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto",
          }}
          title={err ?? undefined}
        >
          📄 {busy ? t("Génération…") : t("Générer un rapport")} <span style={{ fontSize: 10 }}>▾</span>
        </summary>
        <div
          className="card"
          style={{
            position: "absolute", zIndex: 40, top: "calc(100% + 4px)", right: 0,
            minWidth: 210, padding: 8, display: "flex", flexDirection: "column", gap: 2,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {CHOICES.map((c) => (
            <button
              key={`${c.freq}-${c.format}`}
              type="button"
              className="ghost"
              onClick={() => c.format === "pdf" ? runPdf(c.freq) : runCsv(c.freq as ReportFrequency)}
              style={{
                border: "none", background: "transparent", color: "var(--text)",
                textAlign: "left", width: "100%", padding: "6px 8px", borderRadius: 4,
                fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t(c.labelFr)}
            </button>
          ))}
          {err && (
            <span style={{ color: "var(--bad)", fontSize: 12, padding: "4px 8px" }}>{err}</span>
          )}
        </div>
      </details>

      {/* ── Full-screen report preview overlay ─────────────────────────────── */}
      {preview && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.72)",
            display: "flex", flexDirection: "column",
            overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}
        >
          {/* Sticky close bar */}
          <div
            style={{
              position: "sticky", top: 0, zIndex: 10,
              background: "rgba(20,35,58,0.96)", backdropFilter: "blur(6px)",
              padding: "10px 20px",
              display: "flex", alignItems: "center", gap: 12,
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.25)",
                color: "white", borderRadius: 6, padding: "6px 14px",
                cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}
            >
              ✕ {t("Fermer")}
            </button>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
              {preview.title} · {preview.period.label}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                background: "var(--accent, #ff6b35)", border: "none",
                color: "white", borderRadius: 6, padding: "7px 18px",
                cursor: "pointer", fontSize: 13, fontWeight: 700,
              }}
            >
              ⤓ {t("Télécharger PDF")}
            </button>
          </div>

          {/* Report content */}
          <div style={{ padding: "24px 16px", flex: 1 }}>
            <ReportViewer report={preview} hideToolbar />
          </div>
        </div>
      )}
    </>
  );
}
