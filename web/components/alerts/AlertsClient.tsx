"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  const toast = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showAcked, setShowAcked] = useState(false);
  const [severity, setSeverity] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

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
      // Capture the org_id from the first row so we can scope the realtime
      // subscription to this org (we never receive cross-org rows here, but
      // an org-scoped filter avoids spurious websocket traffic).
      if (!orgId && data.length > 0 && data[0].org_id) {
        setOrgId(data[0].org_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showAcked, severity, orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime subscription on alerts, scoped to the current org when known.
  useEffect(() => {
    const sb = supabaseBrowser();
    const channelName = orgId ? `alerts-${orgId}` : "alerts-stream";
    const filter = orgId ? { event: "INSERT" as const, schema: "public", table: "alerts", filter: `org_id=eq.${orgId}` } : { event: "*" as const, schema: "public", table: "alerts" };
    const channel = sb
      .channel(channelName)
      .on("postgres_changes", filter, () => void refresh())
      .subscribe((status: string) => {
        setLiveConnected(status === "SUBSCRIBED");
      });
    return () => {
      setLiveConnected(false);
      void sb.removeChannel(channel);
    };
  }, [orgId, refresh]);

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
        toast.error(`${t("Ack échoué :")} ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refresh, toast, t],
  );

  const ackAll = useCallback(async () => {
    if (!confirm(t("Ack toutes les alertes non lues ?"))) return;
    try {
      const r = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all_unacked: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(t("Alertes marquées comme lues."));
      await refresh();
    } catch (e) {
      toast.error(`${t("Ack échoué :")} ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refresh, toast, t]);

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
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {t("Alertes")}
            <span
              className="tag"
              title={liveConnected ? t("Connecté au flux temps réel") : t("Reconnexion…")}
              style={{
                fontSize: 11,
                color: liveConnected ? "var(--good, #16a34a)" : "var(--muted)",
              }}
            >
              {liveConnected ? t("🟢 Live") : t("⚪ Hors-ligne")}
            </span>
          </h1>
          <div className="subtitle">
            {t("Alertes générées en temps réel depuis les analyses LLM post-appel.")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!showAcked && alerts.length > 0 && (
            <button className="ghost" onClick={ackAll}>
              {t("Ack toutes")}
            </button>
          )}
          <button className="ghost" onClick={() => void refresh()}>
            {t("Rafraîchir")}
          </button>
          <HelpButton contextKey="alerts" />
        </div>
      </div>

      <div className="grid cols-3" style={{ gap: 12 }}>
        <KpiCard label={t("Critique")} value={counts.critical} color="var(--bad)" />
        <KpiCard label={t("Avertissement")} value={counts.warn} color="var(--warn)" />
        <KpiCard label={t("Info")} value={counts.info} color="var(--muted)" />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>
          {showAcked ? t("Alertes acknowledged") : t("Alertes actives")}
        </h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showAcked}
              onChange={(e) => setShowAcked(e.target.checked)}
            />
            <span>{t("Afficher les alertes ack'ées")}</span>
          </label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">{t("Toutes sévérités")}</option>
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
              {showAcked ? t("Aucune alerte ack'ée.") : t("Aucune alerte active.")}
            </p>
            {!showAcked && (
              <>
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {t("Les alertes apparaissent automatiquement quand une analyse LLM post-appel détecte un signal (insulte, plainte, opportunité…). Vous n'avez encore aucune politique configurée ?")}
                </div>
                <div>
                  <Link
                    href="/analyses"
                    className="button"
                    style={{ textDecoration: "none", display: "inline-block" }}
                  >
                    {t("Configurer une politique d'analyse")}
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
                <th>{t("Sév.")}</th>
                <th>{t("Message")}</th>
                <th>{t("Appel")}</th>
                <th>{t("Créée")}</th>
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
                        {t("Détails")}
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
                        {t("Ack")}
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {t("ack'ée")}
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
