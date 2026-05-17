"use client";

import type { VolumeBucket } from "@/app/api/dashboard/overview/route";

export function VolumeChart({ buckets }: { buckets: VolumeBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const w = 100 / Math.max(buckets.length, 1);

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Volume d&apos;appels (24 h glissantes)</h3>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        Max sur 1 h: {max}
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 120, marginTop: 10, display: "block" }}
      >
        {buckets.map((b, i) => {
          const h = (b.count / max) * 38;
          const x = i * w;
          const y = 40 - h;
          return (
            <rect
              key={b.hour}
              x={x + w * 0.1}
              y={y}
              width={w * 0.8}
              height={Math.max(h, 0.4)}
              fill="var(--accent)"
              opacity={b.count === 0 ? 0.18 : 0.85}
              rx={0.4}
            >
              <title>
                {new Date(b.hour).toLocaleString()}: {b.count} appel(s)
              </title>
            </rect>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--muted)",
          marginTop: 4,
        }}
      >
        <span>-24h</span>
        <span>-12h</span>
        <span>maintenant</span>
      </div>
    </div>
  );
}
