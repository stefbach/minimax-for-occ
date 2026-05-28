"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DashboardOverviewResponse } from "@/app/api/dashboard/overview/route";
import { KpiGrid } from "./KpiGrid";
import { VolumeChart } from "./VolumeChart";
import { DispositionsList } from "./DispositionsList";
import { CampaignsTable } from "./CampaignsTable";
import { CopilotPanel } from "./CopilotPanel";
import { HelpButton } from "@/components/help/HelpButton";

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

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1>Tableau de bord</h1>
            <div className="subtitle">
              Vue temps réel du centre d&apos;appels. Mise à jour automatique toutes les 30 s.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="ghost" onClick={fetchData} disabled={refreshing}>
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            <HelpButton contextKey="dashboard" />
          </div>
        </div>

        {/* Raccourcis — accès direct aux actions fréquentes */}
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
      </div>

      <CopilotPanel orgId={orgId} />
    </div>
  );
}
