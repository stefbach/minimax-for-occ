"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { bucketForCall } from "@/lib/qualification";
import { matchesGlobalFilters, hasActiveGlobalFilters, DEFAULT_GLOBAL_FILTERS, type GlobalFilters } from "@/lib/global-filters";
import {
  buildReportData, generateCsv, generatePdf, reportFilename, downloadBlob,
  type ReportCall, type ReportFrequency, type ReportFormat,
} from "@/lib/report";

// "Générer un rapport" — legacy-dashboard parity. Dropdown offering daily /
// weekly aggregation in PDF or CSV. Pulls the period's calls from /api/calls
// (same source as Call Logs), applies the call-evaluable global filters, and
// builds the file entirely client-side.

type Row = ReportCall & {
  answered_at: string | null;
  agent_handles?: { display_name: string | null } | null;
  contacts?: { display_name: string | null } | null;
  from_e164?: string | null;
  to_e164?: string | null;
  lead?: { name: string | null } | null;
};

const CHOICES: { freq: ReportFrequency; format: ReportFormat; label: string }[] = [
  { freq: "daily", format: "pdf", label: "Quotidien — PDF" },
  { freq: "daily", format: "csv", label: "Quotidien — CSV" },
  { freq: "weekly", format: "pdf", label: "Hebdomadaire — PDF" },
  { freq: "weekly", format: "csv", label: "Hebdomadaire — CSV" },
];

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

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const run = async (freq: ReportFrequency, format: ReportFormat) => {
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
      // Same call-evaluable subset of the global filters as the Call Logs tab
      // (source/tentative/éligibilité need the leads table server-side).
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
      const blob = format === "pdf" ? await generatePdf(data, freq) : generateCsv(data, freq);
      downloadBlob(blob, reportFilename({ periodLabel, frequency: freq, format }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "report error");
    } finally {
      setBusy(false);
    }
  };

  return (
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
          minWidth: 200, padding: 8, display: "flex", flexDirection: "column", gap: 2,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        {CHOICES.map((c) => (
          <button
            key={`${c.freq}-${c.format}`}
            type="button"
            className="ghost"
            onClick={() => run(c.freq, c.format)}
            style={{
              border: "none", background: "transparent", color: "var(--text)",
              textAlign: "left", width: "100%", padding: "6px 8px", borderRadius: 4,
              fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {t(c.label)}
          </button>
        ))}
        {err && (
          <span style={{ color: "var(--bad)", fontSize: 12, padding: "4px 8px" }}>{err}</span>
        )}
      </div>
    </details>
  );
}
