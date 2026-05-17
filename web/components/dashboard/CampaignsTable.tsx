"use client";

import Link from "next/link";
import type { CampaignRow } from "@/app/api/dashboard/overview/route";

function stateTone(state: string): string {
  switch (state) {
    case "running":
      return "good";
    case "paused":
      return "warn";
    case "completed":
      return "muted";
    case "cancelled":
      return "bad";
    default:
      return "muted";
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  return `il y a ${days} j`;
}

export function CampaignsTable({ rows }: { rows: CampaignRow[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Campagnes récentes</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {rows.length} campagne(s)
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 18, color: "var(--muted)", fontSize: 13 }}>
          Aucune campagne. Créez-en une depuis la page Campagnes.
        </div>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Nom</th>
              <th>État</th>
              <th>Cibles</th>
              <th>Progression</th>
              <th>Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }}>
                <td>
                  <Link
                    href={`/campaigns/${r.id}`}
                    style={{ color: "var(--accent-2)", fontWeight: 600 }}
                  >
                    {r.name}
                  </Link>
                </td>
                <td>
                  <span className={`tag ${stateTone(r.state)}`}>{r.state}</span>
                </td>
                <td>
                  {r.targets_done} / {r.targets_total}
                </td>
                <td style={{ minWidth: 140 }}>
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
                        width: `${Math.round(r.pct_done * 100)}%`,
                        height: "100%",
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                    {(r.pct_done * 100).toFixed(0)}%
                  </div>
                </td>
                <td style={{ color: "var(--muted)", fontSize: 13 }}>
                  {fmtRelative(r.last_activity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
