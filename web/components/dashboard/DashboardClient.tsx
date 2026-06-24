"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart2, Building2, ClipboardList, Home, Phone, Radio, Sparkles, Users } from "lucide-react";
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
import { LeadsTab } from "./LeadsTab";
import { NhsSuiviTab } from "./NhsSuiviTab";
import { ErrorsAlertsTab } from "./ErrorsAlertsTab";
import { PeriodBar, presetToRange, DEFAULT_FILTERS, type Period, type Filters } from "./PeriodBar";
import { SyncRetellButton } from "./SyncRetellButton";
import { SyncTwilioButton } from "./SyncTwilioButton";
import { ReportButton } from "./ReportButton";
import { ApiStatusPill } from "./ApiStatusPill";
import { useT } from "@/lib/i18n";

type TabId = "overview" | "stats" | "logs" | "live" | "errors" | "ai" | "leads" | "nhs";
const ALL_TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: <Home size={15} /> },
  { id: "stats", label: "Statistiques", icon: <BarChart2 size={15} /> },
  { id: "logs", label: "Call Logs", icon: <ClipboardList size={15} /> },
  { id: "live", label: "Live", icon: <Radio size={15} /> },
  { id: "errors", label: "Erreurs & Alertes", icon: <AlertTriangle size={15} /> },
  { id: "ai", label: "AI Insights", icon: <Sparkles size={15} /> },
  { id: "leads", label: "Leads", icon: <Users size={15} /> },
  { id: "nhs", label: "Suivi NHS S2", icon: <Building2 size={15} /> },
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
  const [searchContacts, setSearchContacts] = useState<Array<{ id: string; display_name: string | null; e164: string | null; table_id?: string }>>([]);
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
        .then((j: { contacts?: Array<{ id: string; display_name: string | null; e164: string | null; table_id?: string }> }) => setSearchContacts(j.contacts ?? []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearchQuery]);

  type PatientSearchResult =
    | { kind: "patient"; patient: NhsPatientsResponse["patients"][number] }
    | { kind: "contact"; id: string; name: string; phone: string | null }
    | { kind: "lead"; id: string; name: string; phone: string | null; table_id: string };

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
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      if (c.table_id) {
        results.push({ kind: "lead", id: c.id, name, phone: c.e164, table_id: c.table_id });
      } else {
        results.push({ kind: "contact", id: c.id, name, phone: c.e164 });
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
            <Phone size={20} style={{ flexShrink: 0 }} />
            <div>
              <h1 style={{ margin: 0 }}>{t("Tableau de bord des appels")}</h1>
              <div className="subtitle">{t("Pilotage et analyse de vos appels Axon")}.</div>
            </div>
          </div>
          {/* page-header is already flex-wrap; the inner button cluster also
              wraps so Actualiser + Help stack cleanly on phones. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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

        {/* Section header — overview gets a full card with patient search;
            other tabs get a simple h2. NHS tab renders its own header. */}
        {tab === "overview" && (() => {
          return (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, flexWrap: "wrap",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderLeft: "4px solid var(--accent)",
              borderRadius: 10,
              padding: "14px 18px",
            }}>
              {/* Left: icon + title + period */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 19, display: "flex", alignItems: "center", gap: 8 }}>
                  <Home size={18} />
                  {t("Vue d'ensemble")}
                </h2>
                <span className="muted" style={{ fontSize: 13 }}>
                  {t("Période")} : {periodLabelFor(period)}
                </span>
              </div>
              {/* Right: patient search */}
              <div style={{ position: "relative", minWidth: 260 }}>
                <input
                  type="search"
                  placeholder={t("Rechercher un patient…")}
                  value={patientSearchQuery}
                  onFocus={() => { loadNhsPatients(); setPatientSearchOpen(true); }}
                  onBlur={() => setTimeout(() => setPatientSearchOpen(false), 180)}
                  onChange={(e) => { setPatientSearchQuery(e.target.value); setPatientSearchOpen(true); }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "8px 12px 8px 34px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 15, pointerEvents: "none", opacity: 0.5 }}>🔍</span>
                {patientSearchOpen && patientSearchResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                    overflow: "hidden",
                  }}>
                    {patientSearchResults.map((r, i) => {
                      if (r.kind === "patient") {
                        const p = r.patient;
                        return (
                          <button
                            key={`p-${p.id ?? i}`}
                            className="ghost"
                            onMouseDown={() => {
                              setPatientSearchQuery("");
                              setPatientSearchOpen(false);
                              setNhsOpenPatientId(p.id ?? null);
                              setTab("nhs");
                            }}
                            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "10px 14px", gap: 2, borderRadius: 0, borderBottom: "1px solid var(--border)" }}
                          >
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name ?? "—"}</span>
                            <span className="muted" style={{ fontSize: 12 }}>{p.phone ?? p.email ?? ""} · <span style={{ color: "var(--accent)" }}>{t("Dossier patient")}</span></span>
                          </button>
                        );
                      } else if (r.kind === "lead") {
                        return (
                          <button
                            key={`l-${r.table_id}-${r.id}`}
                            className="ghost"
                            onMouseDown={() => {
                              setPatientSearchQuery("");
                              setPatientSearchOpen(false);
                              router.push(`/contacts/${r.table_id}?q=${encodeURIComponent(r.name)}`);
                            }}
                            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "10px 14px", gap: 2, borderRadius: 0, borderBottom: "1px solid var(--border)" }}
                          >
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name || "—"}</span>
                            <span className="muted" style={{ fontSize: 12 }}>{r.phone ?? ""} · <span style={{ color: "var(--info, #6aa0ff)" }}>{t("Fiche contact")}</span></span>
                          </button>
                        );
                      } else {
                        return (
                          <button
                            key={`c-${r.id}`}
                            className="ghost"
                            onMouseDown={() => {
                              setPatientSearchQuery("");
                              setPatientSearchOpen(false);
                              setNhsOpenContactId(r.id);
                              setTab("nhs");
                            }}
                            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "10px 14px", gap: 2, borderRadius: 0, borderBottom: "1px solid var(--border)" }}
                          >
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name || "—"}</span>
                            <span className="muted" style={{ fontSize: 12 }}>{r.phone ?? ""} · <span style={{ color: "var(--muted)" }}>{t("Fiche CRM")}</span></span>
                          </button>
                        );
                      }
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {tab !== "nhs" && tab !== "overview" && (() => {
          const active = TABS.find((x) => x.id === tab);
          if (!active) return null;
          const periodScoped = tab === "stats" || tab === "logs" || tab === "ai" || tab === "leads";
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

        {tab === "leads" && (
          <>
            <PeriodBar period={period} filters={filters} onPeriod={setPeriod} onFilters={setFilters} />
            <LeadsTab from={period.from} to={period.to} direction={filters.direction} leadsSource={filters.leadsSource} system={filters.system} global={filters} refreshKey={refreshKey} orgId={orgId} />
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
