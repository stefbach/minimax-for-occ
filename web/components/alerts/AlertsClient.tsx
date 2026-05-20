"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { HelpButton } from "@/components/help/HelpButton";
import { useToast } from "@/lib/use-toast";
import { SkeletonRows } from "@/components/ui/Skeleton";

type Alert = {
  id: string;
  org_id: string;
  rule_id: string | null;
  call_id: string | null;
  severity: "info" | "warn" | "critical" | string;
  message: string;
  payload: Record<string, unknown> | null;
  acked: boolean;
  acked_by: string | null;
  acked_at: string | null;
  created_at: string;
};

function sevClass(s: string): string {
  if (s === "critical") return "tag";
  if (s === "warn") return "tag accent";
  return "tag";
}

function sevColor(s: string): string {
  if (s === "critical") return "var(--bad)";
  if (s === "warn") return "var(--warn)";
  return "var(--muted)";
}

export function AlertsClient() {
  const toast = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showAcked, setShowAcked] = useState(false);
  const [severity, setSeverity] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("acked", showAcked ? "true" : "false");
      if (severity) qs.set("severity", severity);
      const r = await fetch(`/api/alerts?${qs.toString()}`, { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as Alert[];
      setAlerts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showAcked, severity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime subscription on alerts.
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel("alerts-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [refresh]);

  const ackOne = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/alerts/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ acked: true }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await refresh();
      } catch (e) {
        toast.error(`Ack échoué : ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refresh, toast],
  );

  const ackAll = useCallback(async () => {
    if (!confirm("Ack toutes les alertes non lues ?")) return;
    try {
      const r = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all_unacked: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Alertes marquées comme lues.");
      await refresh();
    } catch (e) {
      toast.error(`Ack échoué : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refresh, toast]);

  const counts = useMemo(() => {
    const c = { critical: 0, warn: 0, info: 0 };
    for (const a of alerts) {
      if (a.severity in c) c[a.severity as keyof typeof c]++;
    }
    return c;
  }, [alerts]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Alertes</h1>
          <div className="subtitle">
            Alertes générées en temps réel depuis les analyses LLM post-appel.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!showAcked && alerts.length > 0 && (
            <button className="ghost" onClick={ackAll}>
              Ack toutes
            </button>
          )}
          <button className="ghost" onClick={() => void refresh()}>
            Rafraîchir
          </button>
          <HelpButton contextKey="alerts" />
        </div>
      </div>

      <div className="grid cols-3" style={{ gap: 12 }}>
        <KpiCard label="Critique" value={counts.critical} color="var(--bad)" />
        <KpiCard label="Avertissement" value={counts.warn} color="var(--warn)" />
        <KpiCard label="Info" value={counts.info} color="var(--muted)" />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>
          {showAcked ? "Alertes acknowledged" : "Alertes actives"}
        </h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showAcked}
              onChange={(e) => setShowAcked(e.target.checked)}
            />
            <span>Afficher les alertes ack&apos;ées</span>
          </label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Toutes sévérités</option>
            <option value="critical">critical</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
          </select>
        </div>

        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
        {loading && <SkeletonRows count={5} />}
        {!loading && alerts.length === 0 && (
          <div style={{ display: "grid", gap: 10, padding: "8px 2px" }}>
            <p className="muted" style={{ margin: 0 }}>
              Aucune alerte {showAcked ? "ack'ée" : "active"}.
            </p>
            {!showAcked && (
              <>
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  Les alertes apparaissent automatiquement quand une analyse LLM
                  post-appel détecte un signal (insulte, plainte, opportunité…).
                  Vous n&apos;avez encore aucune politique configurée ?
                </div>
                <div>
                  <Link
                    href="/analyses"
                    className="button"
                    style={{ textDecoration: "none", display: "inline-block" }}
                  >
                    Configurer une politique d&apos;analyse
                  </Link>
                </div>
              </>
            )}
          </div>
        )}
        {alerts.length > 0 && (
          <table className="list">
            <thead>
              <tr>
                <th>Sév.</th>
                <th>Message</th>
                <th>Appel</th>
                <th>Créée</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className={sevClass(a.severity)} style={{ color: sevColor(a.severity) }}>
                      {a.severity}
                    </span>
                  </td>
                  <td>
                    <div>{a.message}</div>
                    {a.payload && (
                      <pre style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(a.payload, null, 2).slice(0, 240)}
                      </pre>
                    )}
                  </td>
                  <td>
                    {a.call_id ? (
                      <Link href={`/calls/${a.call_id}`} className="tag">
                        Détails
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td>
                    {!a.acked ? (
                      <button className="ghost" onClick={() => void ackOne(a.id)}>
                        Ack
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>
                        ack&apos;ée
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 6 }}>{value}</div>
    </div>
  );
}
