"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart } from "./BarChart";
import { KpiTile } from "./KpiTile";
import { Pie } from "./Pie";
import { RangePicker, type Range } from "./RangePicker";

type Overview = {
  totals: {
    calls: number;
    answered: number;
    abandoned: number;
    transferred: number;
    voicemail: number;
    avg_duration_secs: number;
  };
  by_day: Array<{
    day: string;
    calls: number;
    answered: number;
    abandoned: number;
    transferred: number;
    voicemail: number;
  }>;
  by_hour: Array<{ hour: number; calls: number }>;
  by_agent: Array<{
    agent_handle_id: string;
    display_name: string;
    kind: string;
    calls: number;
    avg_duration_secs: number;
  }>;
  by_queue: Array<{
    queue_id: string;
    name: string;
    calls: number;
    avg_wait_secs: number;
  }>;
  by_campaign: Array<{
    campaign_id: string;
    name: string;
    targets_total: number;
    done: number;
    failed: number;
    success_rate: number;
  }>;
  by_disposition: Array<{ disposition: string; count: number }>;
  range: { from: string; to: string };
};

type Props = {
  initial: Overview;
  initialRange: Range;
};

const NF = new Intl.NumberFormat("fr-FR");
const PCT = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 1,
});

function fmtDuration(secs: number): string {
  if (!secs || secs < 0) return "0 s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s} s`;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

function fmtShortDay(iso: string): string {
  // iso = YYYY-MM-DD
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

const DISPOSITION_COLORS = [
  "var(--accent)",
  "var(--info)",
  "var(--good)",
  "var(--warn)",
  "var(--bad)",
  "#a78bfa",
  "#f472b6",
  "#22d3ee",
];

type AgentSort = "calls" | "aht";

export function AnalyticsClient({ initial, initialRange }: Props) {
  const [range, setRange] = useState<Range>(initialRange);
  const [data, setData] = useState<Overview>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentSort, setAgentSort] = useState<AgentSort>("calls");
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `/api/analytics/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Overview;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "erreur");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  const totals = data.totals;
  const answeredRate = totals.calls > 0 ? totals.answered / totals.calls : 0;
  const abandonRate = totals.calls > 0 ? totals.abandoned / totals.calls : 0;

  const hourData = useMemo(
    () =>
      data.by_hour.map((h) => ({
        label: `${h.hour.toString().padStart(2, "0")}h`,
        value: h.calls,
      })),
    [data.by_hour],
  );

  const dayData = useMemo(
    () =>
      data.by_day.map((d) => ({
        label: fmtShortDay(d.day),
        value: d.calls,
      })),
    [data.by_day],
  );

  const dispositionSegments = useMemo(
    () =>
      data.by_disposition.map((d, i) => ({
        label: d.disposition,
        value: d.count,
        color: DISPOSITION_COLORS[i % DISPOSITION_COLORS.length],
      })),
    [data.by_disposition],
  );

  const sortedAgents = useMemo(() => {
    const arr = [...data.by_agent];
    arr.sort((a, b) =>
      agentSort === "calls"
        ? b.calls - a.calls
        : b.avg_duration_secs - a.avg_duration_secs,
    );
    return arr;
  }, [data.by_agent, agentSort]);

  const onExport = (entity: "calls" | "targets") => {
    const url = `/api/analytics/export?format=csv&entity=${entity}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    window.location.href = url;
    setExportOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <RangePicker value={range} onChange={setRange} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading ? (
            <span className="tag">chargement…</span>
          ) : error ? (
            <span className="tag" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>
              {error}
            </span>
          ) : null}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="subtle"
              onClick={() => setExportOpen((v) => !v)}
            >
              Exporter en CSV ▾
            </button>
            {exportOpen ? (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 6,
                  background: "var(--panel)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 8,
                  padding: 6,
                  zIndex: 10,
                  minWidth: 180,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  className="ghost"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => onExport("calls")}
                >
                  Appels (calls)
                </button>
                <button
                  type="button"
                  className="ghost"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => onExport("targets")}
                >
                  Cibles de campagne
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
      >
        <KpiTile label="Appels" value={NF.format(totals.calls)} />
        <KpiTile
          label="% Réponse"
          value={PCT.format(answeredRate)}
          accent="good"
          hint={`${NF.format(totals.answered)} répondus`}
        />
        <KpiTile
          label="DMT"
          value={fmtDuration(totals.avg_duration_secs)}
          accent="info"
          hint="durée moyenne"
        />
        <KpiTile
          label="Taux d'abandon"
          value={PCT.format(abandonRate)}
          accent="bad"
          hint={`${NF.format(totals.abandoned)} abandonnés`}
        />
        <KpiTile
          label="Transferts"
          value={NF.format(totals.transferred)}
          accent="warn"
          hint={`${NF.format(totals.voicemail)} messageries`}
        />
      </div>

      {/* Volume by hour + by day */}
      <div className="grid cols-2">
        <div className="card">
          <h3>Volume par heure</h3>
          <div className="muted">24 créneaux UTC</div>
          <div style={{ marginTop: 12 }}>
            <BarChart
              data={hourData}
              color="var(--accent)"
              showAllLabels={false}
              xTickEvery={2}
              yFormatter={(v) => NF.format(v)}
              ariaLabel="Volume d'appels par heure"
            />
          </div>
        </div>
        <div className="card">
          <h3>Volume par jour</h3>
          <div className="muted">sur la plage sélectionnée</div>
          <div style={{ marginTop: 12 }}>
            <BarChart
              data={dayData}
              color="var(--info)"
              showAllLabels={dayData.length <= 14}
              xTickEvery={Math.max(1, Math.ceil(dayData.length / 14))}
              yFormatter={(v) => NF.format(v)}
              ariaLabel="Volume d'appels par jour"
            />
          </div>
        </div>
      </div>

      {/* Pie + dispositions */}
      <div className="grid cols-2">
        <div
          className="card"
          style={{ display: "flex", gap: 16, alignItems: "center" }}
        >
          <div>
            <h3>Dispositions</h3>
            <div className="muted">répartition des résultats</div>
            <Pie segments={dispositionSegments} ariaLabel="Dispositions des appels" />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flex: 1,
              minWidth: 0,
            }}
          >
            {dispositionSegments.length === 0 ? (
              <span className="muted">Aucune donnée.</span>
            ) : null}
            {dispositionSegments.map((s) => (
              <div
                key={s.label}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    background: s.color,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {NF.format(s.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Files d'attente</h3>
          <div className="muted">temps d'attente moyen avant prise en charge</div>
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table className="list">
              <thead>
                <tr>
                  <th>File</th>
                  <th style={{ textAlign: "right" }}>Appels</th>
                  <th style={{ textAlign: "right" }}>Attente moy.</th>
                </tr>
              </thead>
              <tbody>
                {data.by_queue.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted" style={{ color: "var(--muted)" }}>
                      Aucune file utilisée sur la période.
                    </td>
                  </tr>
                ) : (
                  data.by_queue.map((q) => (
                    <tr key={q.queue_id}>
                      <td>{q.name}</td>
                      <td style={{ textAlign: "right" }}>{NF.format(q.calls)}</td>
                      <td style={{ textAlign: "right" }}>{fmtDuration(q.avg_wait_secs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Agents table */}
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h3>Performance par agent</h3>
            <div className="muted">humains et agents IA confondus</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className={agentSort === "calls" ? "subtle" : "ghost"}
              onClick={() => setAgentSort("calls")}
              style={{ padding: "6px 10px", fontSize: 13 }}
            >
              Trier par appels
            </button>
            <button
              type="button"
              className={agentSort === "aht" ? "subtle" : "ghost"}
              onClick={() => setAgentSort("aht")}
              style={{ padding: "6px 10px", fontSize: 13 }}
            >
              Trier par DMT
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Appels</th>
                <th style={{ textAlign: "right" }}>DMT</th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "var(--muted)" }}>
                    Aucun appel attribué à un agent sur la période.
                  </td>
                </tr>
              ) : (
                sortedAgents.map((a) => (
                  <tr key={a.agent_handle_id}>
                    <td>{a.display_name}</td>
                    <td>
                      <span
                        className={`tag ${a.kind === "ai" ? "accent" : "good"}`}
                      >
                        {a.kind === "ai" ? "IA" : "humain"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{NF.format(a.calls)}</td>
                    <td style={{ textAlign: "right" }}>
                      {fmtDuration(a.avg_duration_secs)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campaigns */}
      <div className="card">
        <h3>Campagnes</h3>
        <div className="muted">taux de réussite par campagne</div>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Campagne</th>
                <th style={{ textAlign: "right" }}>Cibles</th>
                <th style={{ textAlign: "right" }}>Réussies</th>
                <th style={{ textAlign: "right" }}>Échecs</th>
                <th style={{ minWidth: 220 }}>Taux de réussite</th>
              </tr>
            </thead>
            <tbody>
              {data.by_campaign.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    Aucune campagne avec cibles.
                  </td>
                </tr>
              ) : (
                data.by_campaign.map((c) => (
                  <tr key={c.campaign_id}>
                    <td>{c.name}</td>
                    <td style={{ textAlign: "right" }}>{NF.format(c.targets_total)}</td>
                    <td style={{ textAlign: "right" }}>{NF.format(c.done)}</td>
                    <td style={{ textAlign: "right" }}>{NF.format(c.failed)}</td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: 8,
                            background: "var(--bg-2)",
                            borderRadius: 999,
                            overflow: "hidden",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.round(c.success_rate * 100)}%`,
                              height: "100%",
                              background: "var(--good)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--muted)",
                            minWidth: 48,
                            textAlign: "right",
                          }}
                        >
                          {PCT.format(c.success_rate)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
