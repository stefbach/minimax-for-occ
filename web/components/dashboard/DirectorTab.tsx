"use client";

import { useEffect, useState } from "react";
import type { DirectorResponse } from "@/app/api/dashboard/director/route";
import { useT } from "@/lib/i18n";

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DirectorTab({ from, to, direction }: { from: string; to: string; direction: string }) {
  const t = useT();
  const [data, setData] = useState<DirectorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from, to });
    if (direction !== "all") qs.set("direction", direction);
    fetch(`/api/dashboard/director?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) { setData(j); setError(null); }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to, direction]);

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;
  const k = data.kpis;

  const tiles: { label: string; value: string; icon: string; tone?: string; highlight?: boolean }[] = [
    { label: t("Total appels"), value: k.totalCalls.toLocaleString(), icon: "📞", tone: "var(--info)" },
    { label: t("Décrochés"), value: `${k.answered.toLocaleString()} · ${k.answeredPct.toFixed(0)}%`, icon: "✅", tone: "var(--good)" },
    { label: t("Coût consommé"), value: `$${k.cost.toFixed(2)}`, icon: "$", tone: "var(--warn)" },
    { label: t("RDV confirmés"), value: k.rdvConfirmed.toLocaleString(), icon: "📅", tone: "var(--good)", highlight: true },
    { label: t("Taux de conversion"), value: `${k.conversionRate.toFixed(1)}%`, icon: "📈", tone: "var(--accent-2)" },
    { label: t("Durée moyenne"), value: fmtDur(k.avgDuration), icon: "⏱", tone: "var(--info)" },
    { label: t("Callbacks demandés"), value: k.callbacks.toLocaleString(), icon: "↺", tone: "var(--accent)" },
    { label: `${t("Durée")} > ${k.threshold}s`, value: k.callsOverThreshold.toLocaleString(), icon: "⧖", tone: "var(--muted)" },
  ];

  const maxQual = Math.max(1, ...data.qualifications.map((q) => q.count));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="card"
            style={{ padding: 16, borderColor: tile.highlight ? "var(--good)" : undefined }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{tile.icon}</span>
              <span className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>{tile.label}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8, color: tile.tone }}>{tile.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Qualifications")}</h3>
        {data.qualifications.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{t("Aucune donnée")}</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {data.qualifications.map((qrow) => (
              <div key={qrow.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, minWidth: 170 }}>{qrow.key}</span>
                <div style={{ flex: 1, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", height: 16 }}>
                  <div style={{ width: `${(qrow.count / maxQual) * 100}%`, height: "100%", background: "var(--accent)" }} />
                </div>
                <span className="muted" style={{ fontSize: 12, minWidth: 34, textAlign: "right" }}>{qrow.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
