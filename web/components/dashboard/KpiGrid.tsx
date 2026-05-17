"use client";

import type { DashboardKpis } from "@/app/api/dashboard/overview/route";

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

function trend(today: number, yesterday: number, unit: "count" | "pct" | "duration" = "count"): {
  label: string;
  tone: "good" | "bad" | "muted";
} {
  if (yesterday === 0 && today === 0) return { label: "vs hier: —", tone: "muted" };
  if (yesterday === 0) return { label: "vs hier: +∞", tone: "good" };
  const delta = (today - yesterday) / yesterday;
  const sign = delta >= 0 ? "+" : "";
  const label = `vs hier: ${sign}${(delta * 100).toFixed(0)}%`;
  // For abandon rate, higher is bad. We only use tone heuristically.
  void unit;
  const tone = delta === 0 ? "muted" : delta > 0 ? "good" : "bad";
  return { label, tone };
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "bad" | "muted";
}) {
  const color =
    tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : "var(--muted)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
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
      <div style={{ fontSize: 12, color }}>{hint}</div>
    </div>
  );
}

export function KpiGrid({ today, yesterday }: Props) {
  const tCalls = trend(today.calls_count, yesterday.calls_count);
  const tDur = trend(today.avg_duration_secs, yesterday.avg_duration_secs, "duration");
  // Abandon: increase is BAD — flip tone:
  const tAbandonRaw = trend(today.abandon_rate, yesterday.abandon_rate, "pct");
  const tAbandon = {
    ...tAbandonRaw,
    tone:
      tAbandonRaw.tone === "good" ? "bad" : tAbandonRaw.tone === "bad" ? "good" : "muted",
  } as { label: string; tone: "good" | "bad" | "muted" };
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
      <Kpi label="Appels aujourd'hui" value={String(today.calls_count)} hint={tCalls.label} tone={tCalls.tone} />
      <Kpi
        label="Durée moyenne"
        value={fmtDuration(today.avg_duration_secs)}
        hint={tDur.label}
        tone={tDur.tone}
      />
      <Kpi
        label="Taux d'abandon"
        value={fmtPct(today.abandon_rate)}
        hint={tAbandon.label}
        tone={tAbandon.tone}
      />
      <Kpi
        label="Mix IA / humain"
        value={`${Math.round(today.ai_pct * 100)}% / ${Math.round(today.human_pct * 100)}%`}
        hint={tAi.label}
        tone={tAi.tone}
      />
      <Kpi
        label="Campagnes actives"
        value={String(today.active_campaigns)}
        hint={tCamp.label}
        tone={tCamp.tone}
      />
      <Kpi
        label="Contacts à rappeler"
        value={String(today.contacts_to_recall)}
        hint={tRecall.label}
        tone={tRecall.tone}
      />
    </div>
  );
}
