"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DashboardOverviewResponse } from "@/app/api/dashboard/overview/route";
import { KpiGrid } from "./KpiGrid";
import { VolumeChart } from "./VolumeChart";
import { DispositionsList } from "./DispositionsList";
import { CampaignsTable } from "./CampaignsTable";
import { CopilotPanel } from "./CopilotPanel";
import { HelpButton } from "@/components/help/HelpButton";
import { LiveMonitorClient } from "@/components/live/LiveMonitorClient";
import { CallLogsTab } from "./CallLogsTab";

type TabId = "overview" | "stats" | "logs" | "live";
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: "🏠" },
  { id: "stats", label: "Statistiques", icon: "📊" },
  { id: "logs", label: "Call Logs", icon: "📋" },
  { id: "live", label: "Live", icon: "🔴" },
];

type Props = {
  initial: DashboardOverviewResponse | null;
  initialError: string | null;
  orgId?: string;
};

export function DashboardClient({ initial, initialError, orgId }: Props) {
  const [data, setData] = useState<DashboardOverviewResponse | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
      const res = await fetch(`/api/dashboard/overview${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as DashboardOverviewResponse;
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setRefreshing(false);
    }
  }, [orgId]);

  useEffect(() => {
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Tab state driven by ?tab=… so the view is deep-linkable / bookmarkable.
  const router = useRouter();
  const params = useSearchParams();
  const rawTab = params?.get("tab") ?? "overview";
  const tab: TabId = (TABS.find((t) => t.id === rawTab)?.id ?? "overview") as TabId;
  const setTab = (next: TabId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    router.replace(url.pathname + url.search);
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1>Tableau d&apos;analyse</h1>
            <div className="subtitle">
              Pilotage et analyse de vos appels. Mise à jour automatique toutes les 30 s.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="ghost" onClick={fetchData} disabled={refreshing}>
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            <HelpButton contextKey="dashboard" />
          </div>
        </div>

        {/* Tabs — mirrors the OCC director-dashboard layout, adapted to Axon. */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="ghost"
                style={{
                  border: 0,
                  borderRadius: 0,
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  background: "transparent",
                  color: active ? "var(--text)" : "var(--muted)",
                  fontWeight: active ? 600 : 500,
                  padding: "10px 14px",
                }}
              >
                <span style={{ marginRight: 6 }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "overview" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/agents/new" style={{ textDecoration: "none" }}>
                <button>+ Nouvel agent</button>
              </Link>
              <Link href="/campaigns/new" style={{ textDecoration: "none" }}>
                <button>+ Nouvelle campagne</button>
              </Link>
              <Link href="/calls" style={{ textDecoration: "none" }}>
                <button className="ghost">☎ Voir les appels</button>
              </Link>
              <Link href="/contacts" style={{ textDecoration: "none" }}>
                <button className="ghost">◐ Contacts</button>
              </Link>
            </div>

            {error && (
              <div className="card" style={{ borderColor: "var(--bad)" }}>
                <h3 style={{ color: "var(--bad)" }}>Erreur de chargement</h3>
                <p className="muted">{error}</p>
              </div>
            )}

            {data && <KpiGrid today={data.today} yesterday={data.yesterday} />}
            {data && (
              <div className="grid cols-2">
                <VolumeChart buckets={data.volume_24h} />
                <DispositionsList items={data.dispositions} />
              </div>
            )}
            {data && <CampaignsTable rows={data.campaigns} />}
          </>
        )}

        {tab === "stats" && (
          <>
            {data && (
              <div className="grid cols-2">
                <VolumeChart buckets={data.volume_24h} />
                <DispositionsList items={data.dispositions} />
              </div>
            )}
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Performance par agent</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                Vue détaillée par agent — à venir. Pour l&apos;instant la vue
                d&apos;ensemble agrège les principaux indicateurs.
              </p>
            </div>
          </>
        )}

        {tab === "logs" && <CallLogsTab />}

        {tab === "live" && <LiveMonitorClient />}
      </div>

      {tab === "overview" && <CopilotPanel orgId={orgId} />}
    </div>
  );
}
