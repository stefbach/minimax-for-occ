"use client";

import type { DashboardKpis } from "@/app/api/dashboard/overview/route";
import { useT } from "@/lib/i18n";

type Props = {
  today: DashboardKpis;
  yesterday: DashboardKpis;
};

function fmtDuration(secs: number): string {
  if (!secs || secs <= 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

type TrendResult = {
  delta: number | null; // null means "no data" (both zero); Infinity means yesterday was 0 but today > 0
  tone: "good" | "bad" | "muted";
};

function trend(today: number, yesterday: number, unit: "count" | "pct" | "duration" = "count"): TrendResult {
  // For abandon rate, higher is bad. We only use tone heuristically.
  void unit;
  if (yesterday === 0 && today === 0) return { delta: null, tone: "muted" };
  if (yesterday === 0) return { delta: Infinity, tone: "good" };
  const delta = (today - yesterday) / yesterday;
  const tone = delta === 0 ? "muted" : delta > 0 ? "good" : "bad";
  return { delta, tone };
}

function Kpi({
  label,
  value,
  trend: trendData,
  tone,
}: {
  label: string;
  value: string;
  trend: TrendResult;
  tone: "good" | "bad" | "muted";
}) {
  const t = useT();
  const color =
    tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : "var(--muted)";

  let hintText: string;
  if (trendData.delta === null) {
    hintText = `${t("vs hier")}: —`;
  } else if (trendData.delta === Infinity) {
    hintText = `${t("vs hier")}: +∞`;
  } else {
    const sign = trendData.delta >= 0 ? "+" : "";
    hintText = `${t("vs hier")}: ${sign}${(trendData.delta * 100).toFixed(0)}%`;
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {t(label)}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          margin: "6px 0 4px",
          color: "var(--accent-2)",
          letterSpacing: -0.4,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color }}>{hintText}</div>
    </div>
  );
}

export function KpiGrid({ today, yesterday }: Props) {
  const tCalls = trend(today.unique_leads_count, yesterday.unique_leads_count);
  const tDur = trend(today.avg_duration_secs, yesterday.avg_duration_secs, "duration");
  // Abandon: increase is BAD — flip tone:
  const tAbandonRaw = trend(today.abandon_rate, yesterday.abandon_rate, "pct");
  const tAbandon: TrendResult = {
    ...tAbandonRaw,
    tone:
      tAbandonRaw.tone === "good" ? "bad" : tAbandonRaw.tone === "bad" ? "good" : "muted",
  };
  const tAi = trend(today.ai_pct, yesterday.ai_pct, "pct");
  const tCamp = trend(today.active_campaigns, yesterday.active_campaigns);
  const tRecall = trend(today.contacts_to_recall, yesterday.contacts_to_recall);

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(6, minmax(0,1fr))",
        gap: 12,
      }}
    >
      <Kpi label="Leads uniques" value={String(today.unique_leads_count)} trend={tCalls} tone={tCalls.tone} />
      <Kpi
        label="Durée moyenne"
        value={fmtDuration(today.avg_duration_secs)}
        trend={tDur}
        tone={tDur.tone}
      />
      <Kpi
        label="Taux d'abandon"
        value={fmtPct(today.abandon_rate)}
        trend={tAbandon}
        tone={tAbandon.tone}
      />
      <Kpi
        label="Mix IA / humain"
        value={`${Math.round(today.ai_pct * 100)}% / ${Math.round(today.human_pct * 100)}%`}
        trend={tAi}
        tone={tAi.tone}
      />
      <Kpi
        label="Campagnes actives"
        value={String(today.active_campaigns)}
        trend={tCamp}
        tone={tCamp.tone}
      />
      <Kpi
        label="Contacts à rappeler"
        value={String(today.contacts_to_recall)}
        trend={tRecall}
        tone={tRecall.tone}
      />
    </div>
  );
}
