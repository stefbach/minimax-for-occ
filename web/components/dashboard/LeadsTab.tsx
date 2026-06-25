"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadsResponse } from "@/app/api/dashboard/leads/route";
import type { Filters } from "./PeriodBar";

type Props = {
  from: string;
  to: string;
  direction?: string | null;
  leadsSource?: string | null;
  system?: string | null;
  global?: Filters;
  refreshKey?: number;
  orgId?: string;
  campaignId?: string;
};

export function LeadsTab({ from, to, direction, leadsSource, system, global, refreshKey, orgId, campaignId }: Props) {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasData = useRef(false);
  const paramsRef = useRef({ from, to, direction, leadsSource, system, global, orgId, campaignId });
  paramsRef.current = { from, to, direction, leadsSource, system, global, orgId, campaignId };

  const fetchData = useCallback(async () => {
    const { from, to, direction, leadsSource, system, global, orgId, campaignId } = paramsRef.current;
    try {
      if (!hasData.current) setLoading(true);
      setError(null);
      const qs = new URLSearchParams({
        from,
        to,
        ...(direction && { direction }),
        ...(leadsSource && { leads_source: leadsSource }),
        ...(system && { system }),
        ...(global && global.quals.length && { gf_qual: global.quals.join(",") }),
        ...(global && global.agents.length && { gf_agent: global.agents.join(",") }),
        ...(global && global.answered !== "all" && { gf_answered: global.answered }),
        ...(global && global.attempt !== "all" && { gf_attempt: global.attempt }),
        ...(global && global.durations.length && { gf_dur: global.durations.join(",") }),
        ...(global && global.eligibility !== "all" && { gf_elig: global.eligibility }),
        ...(global && global.sources.length && { gf_src: global.sources.join(",") }),
        ...(global && global.q && { gf_q: global.q }),
        ...(orgId && { org_id: orgId }),
        ...(campaignId && campaignId !== "all" && { campaign_id: campaignId }),
      });
      const res = await fetch(`/api/dashboard/leads?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as LeadsResponse;
      hasData.current = true;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="card" style={{ padding: 20 }}>Loading…</div>;
  }

  if (error) {
    return <div className="card" style={{ padding: 20, color: "var(--bad)" }}>Error: {error}</div>;
  }

  if (!data) {
    return <div className="card" style={{ padding: 20 }}>No data</div>;
  }

  const { stats } = data;
  const orphanCalls = stats.orphan_calls ?? 0;
  const distributionTotal = stats.calls_distribution.reduce((s, r) => s + r.calls, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Unique leads
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
            {stats.total_unique_contacts}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            distinct people called
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Total calls
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
            {stats.total_calls}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            calls made
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Calls / lead
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
            {stats.avg_calls_per_contact}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            average per person
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Appts confirmed
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              margin: "6px 0 4px",
              color: "var(--good)",
              letterSpacing: -0.4,
            }}
          >
            {stats.rdv_confirmed}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            confirmed conversion
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Human transfers
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              margin: "6px 0 4px",
              color: "var(--accent)",
              letterSpacing: -0.4,
            }}
          >
            {stats.rdv_transfer}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            to confirm
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 14 }}>Call distribution per lead</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "8px 0", fontWeight: 600 }}>Attempt</th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>Leads</th>
              <th style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>Calls</th>
            </tr>
          </thead>
          <tbody>
            {stats.calls_distribution.map((row) => (
              <tr key={row.attempt} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 0" }}>
                  {row.attempt === 10 ? "10+" : row.attempt}
                </td>
                <td style={{ textAlign: "right", padding: "8px 0" }}>
                  {row.contacts}
                </td>
                <td style={{ textAlign: "right", padding: "8px 0" }}>
                  {row.calls}
                </td>
              </tr>
            ))}
            {orphanCalls > 0 && (
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                <td style={{ padding: "8px 0", fontStyle: "italic" }}>Unlinked</td>
                <td style={{ textAlign: "right", padding: "8px 0" }}>—</td>
                <td style={{ textAlign: "right", padding: "8px 0" }}>{orphanCalls}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
              <td style={{ padding: "8px 0" }}>Total</td>
              <td style={{ textAlign: "right", padding: "8px 0" }}>—</td>
              <td style={{ textAlign: "right", padding: "8px 0" }}>{distributionTotal + orphanCalls}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
