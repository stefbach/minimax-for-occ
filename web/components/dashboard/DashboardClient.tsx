"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DashboardOverviewResponse } from "@/app/api/dashboard/overview/route";
import { KpiGrid } from "./KpiGrid";
import { VolumeChart } from "./VolumeChart";
import { DispositionsList } from "./DispositionsList";
import { CampaignsTable } from "./CampaignsTable";
import { HelpButton } from "@/components/help/HelpButton";
import { LiveMonitorClient } from "@/components/live/LiveMonitorClient";
import { CallLogsTab } from "./CallLogsTab";
import { StatsTab } from "./StatsTab";
import { DirectorTab } from "./DirectorTab";
import { NhsSuiviTab } from "./NhsSuiviTab";
import { ErrorsAlertsTab } from "./ErrorsAlertsTab";
import { PeriodBar, presetToRange, type Period, type Filters } from "./PeriodBar";
import { useT } from "@/lib/i18n";

type TabId = "overview" | "stats" | "logs" | "live" | "errors" | "nhs";
const ALL_TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: "🏠" },
  { id: "stats", label: "Statistiques", icon: "📊" },
  { id: "logs", label: "Call Logs", icon: "📋" },
  { id: "live", label: "Live", icon: "🔴" },
  { id: "errors", label: "Erreurs & Alertes", icon: "⚠️" },
  { id: "nhs", label: "Suivi NHS S2", icon: "🏥" },
];

// Per-org feature flag: enable the NHS S2 tracking tab only for orgs whose
// slug matches a configured pattern. Multi-tenant safe — other orgs never
// see it. Pattern is env-driven for easy ops changes.
const NHS_SLUG_RE = new RegExp(process.env.NEXT_PUBLIC_NHS_ORG_PATTERN ?? "^obesity-care-clinic", "i");

type Props = {
  initial: DashboardOverviewResponse | null;
  initialError: string | null;
  orgId?: string;
  orgSlug?: string | null;
};

export function DashboardClient({ initial, initialError, orgId, orgSlug }: Props) {
  const showNhs = Boolean(orgSlug && NHS_SLUG_RE.test(orgSlug));
  const TABS = ALL_TABS.filter((t) => t.id !== "nhs" || showNhs);
  const t = useT();
  const [data, setData] = useState<DashboardOverviewResponse | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);
  // Period + filters drive the Statistiques and Call Logs tabs.
  const [period, setPeriod] = useState<Period>({ ...presetToRange("7d"), preset: "7d" });
  const [filters, setFilters] = useState<Filters>({ direction: "all", leadsSource: "prod" });

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
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 0, width: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22 }}>📞</span>
            <div>
              <h1 style={{ margin: 0 }}>{t("Tableau de bord des appels")}</h1>
              <div className="subtitle">{t("Pilotage et analyse de vos appels Axon")}.</div>
            </div>
          </div>
          {/* page-header is already flex-wrap; the inner button cluster also
              wraps so Actualiser + Help stack cleanly on phones. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button className="ghost" onClick={fetchData} disabled={refreshing}>
              {refreshing ? t("Actualisation…") : t("Actualiser")}
            </button>
            <HelpButton contextKey="dashboard" />
          </div>
        </div>

        {/* Tabs — mirrors the OCC director-dashboard layout, adapted to Axon. */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {TABS.map((tab_) => {
            const active = tab === tab_.id;
            return (
              <button
                key={tab_.id}
                onClick={() => setTab(tab_.id)}
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
                <span style={{ marginRight: 6 }}>{tab_.icon}</span>
                {t(tab_.label)}
              </button>
            );
          })}
        </div>

        {tab === "overview" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/agents/new" style={{ textDecoration: "none" }}>
                <button>{t("+ Nouvel agent")}</button>
              </Link>
              <Link href="/campaigns/new" style={{ textDecoration: "none" }}>
                <button>{t("+ Nouvelle campagne")}</button>
              </Link>
              <Link href="/calls" style={{ textDecoration: "none" }}>
                <button className="ghost">{t("☎ Voir les appels")}</button>
              </Link>
              <Link href="/contacts" style={{ textDecoration: "none" }}>
                <button className="ghost">{t("◐ Contacts")}</button>
              </Link>
            </div>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <DirectorTab from={period.from} to={period.to} direction={filters.direction} leadsSource={filters.leadsSource} />
            {data && <CampaignsTable rows={data.campaigns} />}
          </>
        )}

        {tab === "stats" && (
          <>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <StatsTab from={period.from} to={period.to} direction={filters.direction} leadsSource={filters.leadsSource} />
          </>
        )}

        {tab === "logs" && (
          <>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <CallLogsTab from={period.from} to={period.to} direction={filters.direction} />
          </>
        )}

        {tab === "live" && <LiveMonitorClient />}

        {tab === "errors" && <ErrorsAlertsTab />}

        {tab === "nhs" && showNhs && <NhsSuiviTab />}
      </div>
    </div>
  );
}
