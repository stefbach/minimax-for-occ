import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

import { LEGACY_ORG_ID as DEFAULT_ORG } from "@/lib/constants";

interface HealthRow {
  id: string;
  e164: string;
  label: string | null;
  country_code: string | null;
  calls_30d: number;
  answered_30d: number;
  answer_rate_pct: number;
  health_status: "active" | "low_volume" | "dormant" | "never_used";
  last_call_at: string | null;
  webhook_configured: boolean | null;
  compliance_jurisdiction: string | null;
  active: boolean;
}

interface DailyBucket {
  day: string;
  calls: number;
}

async function loadData(): Promise<{ rows: HealthRow[]; daily: DailyBucket[] }> {
  if (!hasSupabase()) return { rows: [], daily: [] };
  const sb = supabaseServer();

  let rows: HealthRow[] = [];
  try {
    const { data } = await sb
      .from("phone_numbers_health")
      .select("*")
      .eq("org_id", DEFAULT_ORG)
      .limit(1000);
    rows = ((data ?? []) as unknown as HealthRow[]) ?? [];
  } catch {
    rows = [];
  }

  let daily: DailyBucket[] = [];
  try {
    // 30-day histogram across all of the org's numbers. We do this with a
    // single raw read of calls rather than a Postgres aggregate to keep the
    // migration footprint small.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("calls")
      .select("started_at")
      .eq("org_id", DEFAULT_ORG)
      .gte("started_at", since)
      .limit(50000);
    const byDay = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ started_at: string }>) {
      const d = (r.started_at ?? "").slice(0, 10);
      if (!d) continue;
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    // Fill 30 days, oldest first.
    daily = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      daily.push({ day: d, calls: byDay.get(d) ?? 0 });
    }
  } catch {
    daily = [];
  }

  return { rows, daily };
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card" style={{ display: "grid", gap: 4, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--row-selected, rgba(0,0,0,0.05))", height: 8, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, background: "var(--accent, #4f46e5)", height: "100%" }} />
    </div>
  );
}

export default async function NumbersHealthPage() {
  const { rows, daily } = await loadData();
  const total = rows.length;
  const active = rows.filter((r) => r.health_status === "active").length;
  const lowVol = rows.filter((r) => r.health_status === "low_volume").length;
  const dormant = rows.filter((r) => r.health_status === "dormant").length;
  const never = rows.filter((r) => r.health_status === "never_used").length;
  const calls30d = rows.reduce((acc, r) => acc + (r.calls_30d ?? 0), 0);
  const answered30d = rows.reduce((acc, r) => acc + (r.answered_30d ?? 0), 0);
  const answerRate = calls30d > 0 ? Math.round((answered30d / calls30d) * 1000) / 10 : 0;
  const unconfiguredHooks = rows.filter((r) => !r.webhook_configured).length;

  const top10 = [...rows].sort((a, b) => (b.calls_30d ?? 0) - (a.calls_30d ?? 0)).slice(0, 10);
  const dormantList = rows
    .filter((r) => r.health_status === "dormant")
    .sort((a, b) =>
      new Date(a.last_call_at ?? 0).getTime() - new Date(b.last_call_at ?? 0).getTime(),
    )
    .slice(0, 50);
  const maxDaily = daily.reduce((m, d) => Math.max(m, d.calls), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Santé des numéros</h1>
          <div className="subtitle">
            Volume 30j, dormance et taux de réponse sur l&apos;ensemble des numéros provisionnés.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/numbers" className="button" style={{ textDecoration: "none" }}>
            ← Retour aux numéros
          </Link>
          <HelpButton contextKey="numbers.health" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="Total numéros" value={total} />
        <StatCard label="Actifs (volume)" value={active} hint=">= 5 appels / 30j" />
        <StatCard label="Faible volume" value={lowVol} hint="< 5 appels / 30j" />
        <StatCard label="Dormants" value={dormant} hint="aucun appel >30j" />
        <StatCard label="Jamais utilisés" value={never} />
        <StatCard label="Appels 30j" value={calls30d} />
        <StatCard label="Taux de réponse" value={`${answerRate}%`} hint={`${answered30d} décrochés`} />
        <StatCard label="Webhooks à configurer" value={unconfiguredHooks} />
      </div>

      {/* Histogram */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Appels par jour (30 derniers jours)</h3>
        {daily.length === 0 || maxDaily === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Aucun appel sur les 30 derniers jours.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(30, 1fr)", gap: 2, alignItems: "end", height: 100 }}>
            {daily.map((d) => {
              const h = maxDaily > 0 ? Math.max(2, Math.round((d.calls / maxDaily) * 100)) : 2;
              return (
                <div key={d.day} title={`${d.day}: ${d.calls}`} style={{ textAlign: "center" }}>
                  <div
                    style={{
                      height: `${h}px`,
                      background: "var(--accent, #4f46e5)",
                      borderRadius: 2,
                      width: "100%",
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top 10 */}
      <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid var(--border, #eee)" }}>
          <h3 style={{ margin: 0 }}>Top 10 numéros (volume 30j)</h3>
        </div>
        {top10.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>Aucune donnée.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>#</th>
                <th>Numéro</th>
                <th>Pays</th>
                <th>Appels 30j</th>
                <th>Réponse %</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>
                    <span className="kbd">{r.e164}</span>
                    {r.label && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>({r.label})</span>}
                  </td>
                  <td>{r.country_code ?? "—"}</td>
                  <td>{r.calls_30d ?? 0}</td>
                  <td>{r.answer_rate_pct ?? 0}%</td>
                  <td style={{ width: 200 }}>
                    <Bar value={r.calls_30d ?? 0} max={top10[0]?.calls_30d ?? 1} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dormants */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid var(--border, #eee)" }}>
          <h3 style={{ margin: 0 }}>Numéros dormants (&gt; 30j sans appel)</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Candidats à la libération pour réduire les frais Twilio mensuels.
          </div>
        </div>
        {dormantList.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>Aucun numéro dormant — bravo.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Pays</th>
                <th>Dernier appel</th>
                <th>Compliance</th>
                <th>Webhook</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dormantList.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="kbd">{r.e164}</span>
                    {r.label && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>({r.label})</span>}
                  </td>
                  <td>{r.country_code ?? "—"}</td>
                  <td>{r.last_call_at ? new Date(r.last_call_at).toLocaleDateString() : "—"}</td>
                  <td>{r.compliance_jurisdiction ?? <em className="muted">—</em>}</td>
                  <td>
                    {r.webhook_configured ? (
                      <span className="tag good">✓</span>
                    ) : (
                      <span className="tag" style={{ color: "var(--warn,#b58900)" }}>⚠</span>
                    )}
                  </td>
                  <td>
                    <Link
                      href="/numbers"
                      className="button"
                      style={{ textDecoration: "none", padding: "4px 9px", fontSize: 12 }}
                    >
                      Suggérer release
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
