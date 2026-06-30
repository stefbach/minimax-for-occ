"use client";

import type { DispositionBucket } from "@/app/api/dashboard/overview/route";
import { useT } from "@/lib/i18n";

const LABELS: Record<string, { labelKey: string; color: string }> = {
  resolved: { labelKey: "Résolus", color: "var(--good)" },
  abandoned: { labelKey: "Abandonnés", color: "var(--bad)" },
  transferred: { labelKey: "Transférés", color: "var(--info)" },
  voicemail: { labelKey: "Messagerie", color: "var(--warn)" },
  unknown: { labelKey: "Inconnu", color: "var(--muted)" },
};

export function DispositionsList({ items }: { items: DispositionBucket[] }) {
  const t = useT();
  const total = items.reduce((s, b) => s + b.count, 0);

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("Top dispositions (aujourd'hui)")}</h3>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        Total: {total}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {t("Aucune disposition enregistrée aujourd'hui.")}
          </div>
        )}
        {items.map((b) => {
          const meta = LABELS[b.disposition]
            ? { label: t(LABELS[b.disposition].labelKey), color: LABELS[b.disposition].color }
            : { label: b.disposition, color: "var(--muted)" };
          const pct = total > 0 ? (b.count / total) * 100 : 0;
          return (
            <div key={b.disposition}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                <span style={{ color: "var(--muted)" }}>
                  {b.count} · {pct.toFixed(0)}%
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: meta.color,
                    opacity: 0.8,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
