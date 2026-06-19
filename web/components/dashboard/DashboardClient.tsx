"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DashboardOverviewResponse } from "@/app/api/dashboard/overview/route";
import type { NhsPatientsResponse } from "@/app/api/dashboard/nhs-suivi/patients/route";
import { KpiGrid } from "./KpiGrid";
import { VolumeChart } from "./VolumeChart";
import { DispositionsList } from "./DispositionsList";
import { CampaignsTable } from "./CampaignsTable";
import { HelpButton } from "@/components/help/HelpButton";
import { LiveMonitorClient } from "@/components/live/LiveMonitorClient";
import { CallLogsTab } from "./CallLogsTab";
import { StatsTab } from "./StatsTab";
import { DirectorTab } from "./DirectorTab";
import { AiInsightsTab } from "./AiInsightsTab";
import { NhsSuiviTab } from "./NhsSuiviTab";
import { ErrorsAlertsTab } from "./ErrorsAlertsTab";
import { PeriodBar, presetToRange, DEFAULT_FILTERS, type Period, type Filters } from "./PeriodBar";
import { SyncRetellButton } from "./SyncRetellButton";
import { SyncTwilioButton } from "./SyncTwilioButton";
import { ReportButton } from "./ReportButton";
import { ApiStatusPill } from "./ApiStatusPill";
import { useT } from "@/lib/i18n";

type TabId = "overview" | "stats" | "logs" | "live" | "errors" | "ai" | "nhs";
const ALL_TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: "🏠" },
  { id: "stats", label: "Statistiques", icon: "📊" },
  { id: "logs", label: "Call Logs", icon: "📋" },
  { id: "live", label: "Live", icon: "🔴" },
  { id: "errors", label: "Erreurs & Alertes", icon: "⚠️" },
  { id: "ai", label: "AI Insights", icon: "✨" },
  { id: "nhs", label: "Suivi NHS S2", icon: "🏥" },
];

// Short human label for the active period, e.g. "05/06" or "01/06 – 05/06".
function periodLabelFor(p: Period): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const a = fmt(p.from);
  const b = fmt(p.to);
  return a === b ? a : `${a} – ${b}`;
}

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
  // Default to "Aujourd'hui" so the manager opens onto today's activity
  // rather than 7 days of history (Wati's June 10 preference — they want
  // the live picture first, drill back if needed).
  const [period, setPeriod] = useState<Period>({ ...presetToRange("today"), preset: "today" });
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  // Bumped by 'Actualiser' so every active tab re-fetches, not just the
  // overview tile. Each tab includes refreshKey in its dependency array;
  // a change forces useEffect to fire even when from/to/filters didn't
  // move (Wati June 10: the button looked broken because it only
  // refreshed the overview header, leaving the Vue d'ensemble tiles
  // stale).
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Patient search bar ──────────────────────────────────────────────────
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [nhsPatients, setNhsPatients] = useState<NhsPatientsResponse["patients"] | null>(null);
  const [searchContacts, setSearchContacts] = useState<Array<{ id: string; display_name: string | null; e164: string | null }>>([]);
  const [nhsOpenPatientId, setNhsOpenPatientId] = useState<string | null>(null);
  const [nhsOpenContactId, setNhsOpenContactId] = useState<string | null>(null);

  const loadNhsPatients = async () => {
    if (nhsPatients !== null) return;
    try {
      const r = await fetch("/api/dashboard/nhs-suivi/patients", { cache: "no-store" });
      const j = (await r.json()) as NhsPatientsResponse;
      if (r.ok) setNhsPatients(j.patients);
    } catch { setNhsPatients([]); }
  };

  useEffect(() => {
    const q = patientSearchQuery.trim();
    if (q.length < 2) { setSearchContacts([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/desk/search-contacts?q=${encodeURIComponent(q)}&limit=6`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { contacts?: Array<{ id: string; display_name: string | null; e164: string | null }> }) => setSearchContacts(j.contacts ?? []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearchQuery]);

  type PatientSearchResult =
    | { kind: "patient"; patient: NhsPatientsResponse["patients"][number] }
    | { kind: "contact"; id: string; name: string; phone: string | null };

  const patientSearchQ = patientSearchQuery.trim().toLowerCase();
  const patientSearchResults: PatientSearchResult[] = (() => {
    if (patientSearchQ.length < 2) return [];
    const results: PatientSearchResult[] = [];
    const seen = new Set<string>();
    for (const p of nhsPatients ?? []) {
      if (`${p.name ?? ""} ${p.phone ?? ""} ${p.email ?? ""}`.toLowerCase().includes(patientSearchQ)) {
        results.push({ kind: "patient", patient: p });
        seen.add((p.name ?? "").toLowerCase());
      }
    }
    for (const c of searchContacts) {
      const name = c.display_name ?? "";
      if (!seen.has(name.toLowerCase())) {
        results.push({ kind: "contact", id: c.id, name, phone: c.e164 });
        seen.add(name.toLowerCase());
      }
    }
    return results.slice(0, 8);
  })();
  // ────────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      // Re-anchor the active period to NOW before refetching. For 'today'
      // / '7d' / '30d' presets, `to` was frozen at page-load time and any
      // calls placed after that were excluded from /api/dashboard/director —
      // Wati June 10: 'le bouton actualiser ne fonctionne toujours pas, je
      // dois rafraichir la page'. We don't touch absolute date ranges
      // (date:.. / range:..) since those have a deliberate end date.
      setPeriod((p) =>
        p.preset.startsWith("date:") || p.preset.startsWith("range:")
          ? p
          : { ...presetToRange(p.preset), preset: p.preset },
      );
      const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
      const res = await fetch(`/api/dashboard/overview${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as DashboardOverviewResponse;
      setData(j);
      setError(null);
      setRefreshKey((k) => k + 1);
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
            {/* Patient search bar */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none", opacity: 0.5 }}>🔍</span>
              <input
                type="search"
                value={patientSearchQuery}
                onChange={(e) => setPatientSearchQuery(e.target.value)}
                onFocus={() => { setPatientSearchOpen(true); loadNhsPatients(); }}
                onBlur={() => setTimeout(() => setPatientSearchOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Escape") { setPatientSearchQuery(""); setPatientSearchOpen(false); } }}
                placeholder={t("Rechercher un patient…")}
                style={{
                  padding: "7px 14px 7px 36px", fontSize: 13, borderRadius: 999, width: 230,
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.3)",
                  color: "inherit", outline: "none",
                }}
              />
              {patientSearchOpen && patientSearchResults.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340,
                  background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 10,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200, overflow: "hidden",
                }}>
                  <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 14px 4px" }}>
                    {patientSearchResults.length} {t("résultat(s)")}
                  </div>
                  {patientSearchResults.map((r, idx) => {
                    const name = r.kind === "patient" ? (r.patient.name ?? "—") : r.name;
                    const sub = r.kind === "patient"
                      ? (r.patient.phone ?? r.patient.email ?? t("Dossier patient"))
                      : (r.phone ?? t("Fiche CRM"));
                    const isNhs = r.kind === "patient";
                    const initials = name.split(" ").filter(Boolean).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <button
                        key={idx}
                        type="button"
                        onMouseDown={() => {
                          if (r.kind === "patient") {
                            setNhsOpenPatientId(r.patient.id);
                          } else {
                            setNhsOpenContactId(r.id);
                          }
                          setTab("nhs");
                          setPatientSearchQuery("");
                          setPatientSearchOpen(false);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, width: "100%",
                          padding: "10px 14px", background: "transparent", border: "none",
                          borderTop: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          background: isNhs ? "rgba(99,102,241,0.2)" : "rgba(100,116,139,0.2)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700,
                          color: isNhs ? "#a5b4fc" : "var(--muted)", flexShrink: 0,
                        }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "#fff" }}>{name}</div>
                          <div style={{ fontSize: 11, color: "#6b7a99", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, flexShrink: 0,
                          border: `1px solid ${isNhs ? "#a5b4fc" : "var(--border)"}`,
                          color: isNhs ? "#a5b4fc" : "var(--muted)",
                          background: isNhs ? "rgba(99,102,241,0.12)" : "transparent",
                        }}>
                          {isNhs ? "NHS" : t("CRM")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <ApiStatusPill />
            <ReportButton
              from={period.from}
              to={period.to}
              periodLabel={periodLabelFor(period)}
              direction={filters.direction}
              leadsSource={filters.leadsSource}
              system={filters.system}
              global={filters}
            />
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

        {/* Section header — tells the operator which tab they're in (legacy
            parity), with the active period for the period-scoped tabs.
            Skipped for the NHS tab which renders its own header. */}
        {tab !== "nhs" && (() => {
          const active = TABS.find((x) => x.id === tab);
          if (!active) return null;
          const periodScoped = tab === "overview" || tab === "stats" || tab === "logs" || tab === "ai";
          return (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>
                <span style={{ marginRight: 8 }}>{active.icon}</span>
                {t(active.label)}
              </h2>
              {periodScoped && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {t("Période")} : {periodLabelFor(period)}
                </span>
              )}
            </div>
          );
        })()}

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
              <SyncRetellButton />
              <SyncTwilioButton />
            </div>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <DirectorTab from={period.from} to={period.to} direction={filters.direction} leadsSource={filters.leadsSource} system={filters.system} slot={filters.slot} global={filters} refreshKey={refreshKey} />
            {data && <CampaignsTable rows={data.campaigns} />}
          </>
        )}

        {tab === "stats" && (
          <>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <StatsTab from={period.from} to={period.to} direction={filters.direction} leadsSource={filters.leadsSource} system={filters.system} global={filters} />
          </>
        )}

        {tab === "logs" && (
          <>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <CallLogsTab from={period.from} to={period.to} direction={filters.direction} leadsSource={filters.leadsSource} system={filters.system} global={filters} />
          </>
        )}

        {tab === "ai" && (
          <>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <AiInsightsTab
              from={period.from}
              to={period.to}
              direction={filters.direction}
              leadsSource={filters.leadsSource}
              system={filters.system}
              periodLabel={periodLabelFor(period)}
            />
          </>
        )}

        {tab === "live" && <LiveMonitorClient leadsSource={filters.leadsSource} system={filters.system} />}

        {tab === "errors" && <ErrorsAlertsTab />}

        {tab === "nhs" && showNhs && (
          <NhsSuiviTab
            openPatientId={nhsOpenPatientId}
            openContactId={nhsOpenContactId}
            onOpened={() => { setNhsOpenPatientId(null); setNhsOpenContactId(null); }}
          />
        )}
      </div>
    </div>
  );
}
