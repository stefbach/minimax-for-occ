"use client";

import type { DispositionBucket } from "@/app/api/dashboard/overview/route";

const LABELS: Record<string, { label: string; color: string }> = {
  resolved: { label: "Résolus", color: "var(--good)" },
  abandoned: { label: "Abandonnés", color: "var(--bad)" },
  transferred: { label: "Transférés", color: "var(--info)" },
  voicemail: { label: "Messagerie", color: "var(--warn)" },
  unknown: { label: "Inconnu", color: "var(--muted)" },
};

export function DispositionsList({ items }: { items: DispositionBucket[] }) {
  const total = items.reduce((s, b) => s + b.count, 0);

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Top dispositions (aujourd&apos;hui)</h3>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        Total: {total}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Aucune disposition enregistrée aujourd&apos;hui.
          </div>
        )}
        {items.map((b) => {
          const meta = LABELS[b.disposition] ?? { label: b.disposition, color: "var(--muted)" };
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
