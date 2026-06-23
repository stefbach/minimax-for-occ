"use client";

import { useEffect, useState } from "react";
import type { NhsSuiviResponse } from "@/app/api/dashboard/nhs-suivi/route";
import type { NhsPatientsResponse } from "@/app/api/dashboard/nhs-suivi/patients/route";
import type { NhsPatientDetail } from "@/app/api/dashboard/nhs-suivi/patients/[id]/route";
import type { NhsPatient, PatientStatus } from "@/lib/nhs-patients";
import { useT } from "@/lib/i18n";
import {
  NHS_REPORT,
  NHS_REPORT_AS_OF,
  NHS_REPORT_APPROVED_BREAKDOWN,
  NHS_REPORT_TOTAL_SUBMITTED,
  type NhsReportKey,
  type NhsReportPatient,
} from "@/lib/nhs-report";
import { MyNhsAssignmentsCard } from "./MyNhsAssignmentsCard";

// Clones the OCC demo's "Suivi patient NHS S2" panel in Axon's theme.
// Visible only for orgs where the feature flag is on (see DashboardClient).

// Queue dot colors — same trio as the legacy dashboard's coordinator cards.
const COORDINATOR_TONES: Record<string, string> = {
  Summer: "#f59e0b",
  Rain: "#3b82f6",
  Stormi: "#8b5cf6",
};

export function NhsSuiviTab({
  openPatientId,
  openContactId,
  onOpened,
}: {
  openPatientId?: string | null;
  openContactId?: string | null;
  onOpened?: () => void;
} = {}) {
  const t = useT();
  const [data, setData] = useState<NhsSuiviResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Bloqué 5j+" card expands inline into the stalled-patient list.
  const [showStalled, setShowStalled] = useState(false);
  // Same 3-view navigation as the legacy dashboard: clicking a card opens the
  // patient LIST pre-filtered on the matching status; clicking a patient opens
  // the full dossier (checklist 11 docs, timeline, statut NHS, actions).
  const [view, setView] = useState<NhsView>({ name: "dashboard" });
  // Maps each card to the same list filter the legacy dashboard uses.
  const METRIC_FILTER: Record<string, PatientFilter> = {
    email_j0: "all", email_j2: "all", whatsapp_j2: "all", responses: "has-response",
    no_document: "no-docs", partial: "partiels", complete: "complets", pending_3d: "sans-reponse",
    doc_medical_report: "all", doc_undue_delay: "all", doc_s2_declaration: "all", doc_estimate: "all",
    sent_nhs: "envoye-nhs", in_review: "envoye-nhs", accepted: "envoye-nhs", rejected: "envoye-nhs",
    submitted_month: "envoye-nhs", ready: "complets",
  };
  const openDrill = (metric: string, _title?: string) =>
    setView({ name: "list", filter: METRIC_FILTER[metric] ?? "all" });
  // Open a patient or contact passed from the Overview search bar.
  useEffect(() => {
    if (openPatientId) {
      setView({ name: "detail", id: openPatientId, from: "all" });
      onOpened?.();
    } else if (openContactId) {
      setView({ name: "contact-detail", contactId: openContactId, displayName: "" });
      onOpened?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPatientId, openContactId]);

  // Retire un patient d'une file coordinateur (ferme l'assignation ouverte
  // dans la table partagée), puis rafraîchit les files.
  const [unassigning, setUnassigning] = useState<string | null>(null);

  // Global patient search — API patients are lazy-loaded on first focus.
  // NHS_REPORT patients (static) are always included so names like "Mark Griffith"
  // (who only exist in the static report) are always found.
  // Axon contacts are fetched via debounced search so patients like Lorraine Turner
  // (in CRM but not in the NHS programme) are also searchable.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchPatients, setSearchPatients] = useState<NhsPatientsResponse["patients"] | null>(null);
  const [deskContacts, setDeskContacts] = useState<Array<{ id: string; display_name: string | null; e164: string | null }>>([]);
  const loadSearchPatients = async () => {
    if (searchPatients !== null) return;
    try {
      const r = await fetch("/api/dashboard/nhs-suivi/patients", { cache: "no-store" });
      const j = (await r.json()) as NhsPatientsResponse;
      if (r.ok) setSearchPatients(j.patients);
    } catch { setSearchPatients([]); }
  };
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setDeskContacts([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/desk/search-contacts?q=${encodeURIComponent(q)}&limit=4`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { contacts?: Array<{ id: string; display_name: string | null; e164: string | null }> }) => {
          setDeskContacts(j.contacts ?? []);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const NHS_REAL_KEYS_SEARCH: NhsReportKey[] = ["approved", "pending_nhs", "missing_docs", "rejected", "dropped_out", "to_submit"];

  type SearchResult =
    | { kind: "patient"; patient: NhsPatientsResponse["patients"][number] }
    | { kind: "report"; patient: NhsReportPatient; reportKey: NhsReportKey }
    | { kind: "contact"; id: string; name: string; phone: string | null };

  const searchQ = searchQuery.trim().toLowerCase();
  const searchResults: SearchResult[] = (() => {
    if (searchQ.length < 2) return [];
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    // 1. API patients (NHS programme — email_sent + whatsapp_sent)
    for (const p of searchPatients ?? []) {
      if (`${p.name ?? ""} ${p.phone ?? ""} ${p.email ?? ""}`.toLowerCase().includes(searchQ)) {
        results.push({ kind: "patient", patient: p });
        seen.add((p.name ?? "").toLowerCase());
      }
    }
    // 2. NHS_REPORT patients (static — always searched even before API loads)
    for (const k of NHS_REAL_KEYS_SEARCH) {
      for (const p of NHS_REPORT[k].patients) {
        if (p.name.toLowerCase().includes(searchQ) && !seen.has(p.name.toLowerCase())) {
          results.push({ kind: "report", patient: p, reportKey: k });
          seen.add(p.name.toLowerCase());
        }
      }
    }
    // 3. Axon CRM contacts (fetched by debounced desk search — finds patients
    //    who are in Supervision but not in the NHS programme)
    for (const c of deskContacts) {
      const name = c.display_name ?? "";
      if (!seen.has(name.toLowerCase())) {
        results.push({ kind: "contact", id: c.id, name, phone: c.e164 });
        seen.add(name.toLowerCase());
      }
    }
    return results.slice(0, 8);
  })();

  const openFirstSearchResult = () => {
    const first = searchResults[0];
    if (!first) return;
    if (first.kind === "patient") {
      setView({ name: "detail", id: first.patient.id, from: "all" });
    } else if (first.kind === "report") {
      setView({ name: "report-detail", patient: first.patient, reportKey: first.reportKey });
    } else {
      setView({ name: "contact-detail", contactId: first.id, displayName: first.name });
    }
    setSearchQuery("");
    setSearchOpen(false);
  };
  const unassign = async (leadId: string) => {
    setUnassigning(leadId);
    try {
      await fetch("/api/dashboard/nhs-suivi/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, unassign: true }),
      });
      await fetchData();
    } finally {
      setUnassigning(null);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/dashboard/nhs-suivi", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60_000);
    return () => clearInterval(t);
  }, []);

  // All hooks above this line — the sub-views replace the whole tab body.
  if (view.name === "list") {
    return (
      <PatientListView
        filter={view.filter}
        onBack={() => setView({ name: "dashboard" })}
        onChangeFilter={(filter) => setView({ name: "list", filter })}
        onOpenPatient={(id) => setView({ name: "detail", id, from: view.filter })}
      />
    );
  }
  if (view.name === "report-list") {
    return (
      <NhsReportListView
        reportKey={view.key}
        onBack={() => setView({ name: "dashboard" })}
        onChangeKey={(key) => setView({ name: "report-list", key })}
        onOpenPatient={(patient) => setView({ name: "report-detail", patient, reportKey: view.key })}
      />
    );
  }
  if (view.name === "report-detail") {
    return (
      <NhsReportDetailView
        patient={view.patient}
        reportKey={view.reportKey}
        onBackDashboard={() => setView({ name: "dashboard" })}
        onBackList={() => setView({ name: "report-list", key: view.reportKey })}
      />
    );
  }
  if (view.name === "detail") {
    return (
      <PatientDetailView
        id={view.id}
        fromFilter={view.from}
        onBackDashboard={() => setView({ name: "dashboard" })}
        onBackList={() => setView({ name: "list", filter: view.from })}
      />
    );
  }
  if (view.name === "contact-detail") {
    return (
      <ContactDetailView
        contactId={view.contactId}
        displayName={view.displayName}
        onBackDashboard={() => setView({ name: "dashboard" })}
      />
    );
  }

  if (loading && !data) return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (!data) return null;

  const pct =
    data.monthly_objective > 0
      ? Math.min(100, Math.round((data.submitted_this_month / data.monthly_objective) * 100))
      : 0;
  const remaining = Math.max(0, data.monthly_objective - data.submitted_this_month);
  const now = new Date();
  const lastDayMs = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
  const daysLeftInMonth = Math.max(0, Math.ceil((lastDayMs - now.getTime()) / 86400_000));
  const clock = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 22px", borderRadius: 12,
        background: "linear-gradient(135deg, rgba(99,102,241,0.09) 0%, rgba(59,130,246,0.05) 100%)",
        border: "1px solid rgba(99,102,241,0.18)",
        borderLeft: "4px solid #6366f1",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
          }}>🗂️</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#fff" }}>{t("Suivi patient NHS S2")}</h2>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, letterSpacing: 0.6,
                background: "rgba(99,102,241,0.22)", color: "#a5b4fc",
              }}>NHS S2</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7a99" }}>
              {t("Pipeline complet · De l'appel initial à la soumission NHS S2")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Global patient search */}
          <div style={{ position: "relative" }}>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { setSearchOpen(true); loadSearchPatients(); }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter") openFirstSearchResult(); if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); } }}
              placeholder={t("Rechercher un patient…")}
              style={{
                padding: "7px 14px 7px 36px", fontSize: 13, borderRadius: 999, width: 230,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.3)",
                color: "inherit", outline: "none",
              }}
            />
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none", opacity: 0.5 }}>🔍</span>
            {searchOpen && searchResults.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320,
                background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 10,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 100, overflow: "hidden",
              }}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 14px 4px" }}>
                  {searchResults.length} {t("résultat(s)")}
                </div>
                {searchResults.map((r, idx) => {
                  const name = r.kind === "patient" ? (r.patient.name ?? "—") : r.kind === "report" ? r.patient.name : r.name;
                  const sub = r.kind === "patient"
                    ? (r.patient.phone ?? r.patient.email ?? "Dossier patient")
                    : r.kind === "report"
                    ? `NHS · ${r.patient.sent_to_nhs ? `Envoyé ${r.patient.sent_to_nhs}` : "Rapport statique"}`
                    : (r.phone ?? t("Fiche CRM"));
                  const tone = r.kind === "patient" ? STATUS_TONE[r.patient.status] : r.kind === "report" ? "var(--info)" : "var(--muted)";
                  const badge = r.kind === "patient" ? t(STATUS_LABEL[r.patient.status]) : r.kind === "report" ? t("Rapport NHS") : t("CRM");
                  const initials = initialsOfName(name);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onMouseDown={() => {
                        if (r.kind === "patient") {
                          setView({ name: "detail", id: r.patient.id, from: "all" });
                        } else if (r.kind === "report") {
                          setView({ name: "report-detail", patient: r.patient, reportKey: r.reportKey });
                        } else {
                          setView({ name: "contact-detail", contactId: r.id, displayName: r.name });
                        }
                        setSearchQuery("");
                        setSearchOpen(false);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "10px 14px", background: "transparent", border: "none",
                        borderTop: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <Avatar initials={initials} size={30} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#fff" }}>{name}</div>
                        <div style={{ fontSize: 11, color: "#6b7a99", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, flexShrink: 0,
                        border: `1px solid ${tone}`, color: tone,
                        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
                      }}>
                        {badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <span style={{ fontSize: 12, color: "#6b7a99" }}>{clock}</span>
          <button onClick={fetchData} className="ghost" style={{ padding: "6px 14px", fontSize: 13 }}>↻ {t("Actualiser")}</button>
        </div>
      </div>

      {/* Objectif mensuel — compact inline banner */}
      <div
        className="card"
        style={{
          padding: "12px 18px",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--info) 90%, #1d4ed8) 0%, #1d4ed8 100%)",
          color: "#fff",
          borderColor: "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.85 }}>
              {t("Objectif mensuel NHS S2")}
            </div>
            <button
              type="button"
              onClick={() => openDrill("submitted_month", t("Objectif mensuel NHS S2"))}
              title={t("Voir les dossiers soumis ce mois")}
              style={{
                fontSize: 26, fontWeight: 700, lineHeight: 1.2, marginTop: 2,
                background: "none", border: "none", color: "inherit", padding: 0,
                cursor: "pointer", font: "inherit", display: "inline",
              }}
            >
              {data.submitted_this_month}
            </button>
            <span style={{ fontSize: 16, opacity: 0.7, marginLeft: 4 }}>/ {data.monthly_objective}</span>
            <span style={{ fontSize: 12, opacity: 0.9, marginLeft: 10 }}>
              {t("dossiers soumis")} · {remaining} {t("restants")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{pct}%</div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>{daysLeftInMonth} {t("j. restants")}</div>
            </div>
            <div style={{ width: 80, height: 6, background: "rgba(255,255,255,0.25)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "#fff" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Alert cards — 3 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <AlertRow
          tone="bad"
          icon="⚠"
          title={t("Escalade requise")}
          subtitle={t("Patients sans réponse depuis 3 jours+")}
          ctaLabel={t("Voir et assigner")}
          onCta={() => openDrill("pending_3d", t("Escalade requise"))}
          value={data.pending_response_3d_plus}
        />
        <AlertRow
          tone="good"
          icon="✓"
          title={t("Prêts à soumettre")}
          subtitle={t("Dossiers complets — soumission NHS possible")}
          ctaLabel={t("Voir les patients")}
          onCta={() => openDrill("ready", t("Prêts à soumettre"))}
          value={data.ready_to_submit}
        />
        <AlertRow
          tone="warn"
          icon="⏳"
          title={t("Bloqué — sans changement 5j+")}
          subtitle={
            data.stalled.count === 0
              ? t("Aucun dossier partiel bloqué")
              : t("Dossiers partiels sans activité depuis 5 jours ou plus")
          }
          value={data.stalled.count}
          ctaLabel={data.stalled.count > 0 ? (showStalled ? t("Masquer la liste") : t("Voir les patients")) : undefined}
          onCta={data.stalled.count > 0 ? () => setShowStalled((v) => !v) : undefined}
        />
      </div>

      {/* Stalled patients inline expansion — spans full width below the 3-col grid */}
      {showStalled && data.stalled.patients.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Patient")}</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Téléphone")}</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Email</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Qualification")}</th>
                  <th style={{ textAlign: "center", padding: "10px 12px" }}>{t("Docs cliniques")}</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Dernière activité")}</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>{t("Bloqué depuis")}</th>
                </tr>
              </thead>
              <tbody>
                {data.stalled.patients.map((p, i) => (
                  <tr key={`${p.phone ?? p.email ?? i}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{p.name ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{p.phone ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{p.email ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{p.qualification ?? "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <span style={{ color: "var(--warn)", fontWeight: 600 }}>{p.docs_filled}/{p.docs_total}</span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {p.last_activity
                        ? new Date(p.last_activity).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
                        : t("Jamais")}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--warn)", fontWeight: 600 }}>
                      {p.days_stalled != null ? `${p.days_stalled} ${t("jours")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.stalled.count > data.stalled.patients.length && (
            <p className="muted" style={{ fontSize: 12, margin: 0, padding: "8px 12px" }}>
              {t("Liste limitée aux")} {data.stalled.patients.length} {t("plus anciens")} · {data.stalled.count} {t("au total")}
            </p>
          )}
        </div>
      )}

      {/* "My assignments" — visible only to flagged coordinators (or anyone
          who currently has open assignments). Clicking a row opens the same
          patient detail the queue cards do, so the action surface is identical. */}
      <MyNhsAssignmentsCard onOpenPatient={(id) => setView({ name: "detail", id, from: "all" })} />

      {/* Files coordinateurs — driven by users.is_nhs_coordinator. */}
      <div>
        <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }} className="muted">
          👥 {t("Files coordinateurs")}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {data.coordinators.map((q) => {
            const dot = COORDINATOR_TONES[q.name] ?? "var(--accent)";
            return (
              <div key={q.name} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, background: dot }} />
                    {q.name}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>{q.patients.length}</span>
                </div>
                {q.patients.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("Aucun patient assigné")}</p>
                ) : (
                  <div style={{ display: "grid", gap: 2 }}>
                    {q.patients.slice(0, 8).map((p, i) => (
                      <div
                        key={`${p.lead_id}-${i}`}
                        title={[p.phone, p.reason, p.assigned_at ? new Date(p.assigned_at).toLocaleDateString("fr-FR") : null].filter(Boolean).join(" · ")}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          padding: "6px 4px", borderTop: i > 0 ? "1px solid var(--border)" : "none", fontSize: 13,
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name ?? p.phone ?? t("Lead introuvable (supprimé)")}
                        </span>
                        <button
                          type="button"
                          className="ghost"
                          title={t("Désassigner")}
                          aria-label={`${t("Désassigner")} ${p.name ?? p.phone ?? ""}`}
                          disabled={unassigning === p.lead_id}
                          onClick={() => unassign(p.lead_id)}
                          style={{ padding: "1px 8px", fontSize: 12, color: "var(--bad)", borderColor: "transparent", flexShrink: 0 }}
                        >
                          {unassigning === p.lead_id ? "…" : "✕"}
                        </button>
                      </div>
                    ))}
                    {q.patients.length > 8 && (
                      <p className="muted" style={{ margin: 0, fontSize: 12, paddingTop: 4 }}>
                        +{q.patients.length - 8} {t("autres")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Communication patient */}
      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          ⌑ {t("Communication patient")}
        </div>
        <div className="grid-kpi">
          <CommCard
            label={t("Email explicatif envoyé")}
            value={data.comms.email_j0_sent}
            hint={t("Email initial J0")}
            tone="var(--info)"
            icon="✉"
            onClick={() => openDrill("email_j0", t("Email explicatif envoyé"))}
          />
          <CommCard
            label={t("Email relance J+2")}
            value={data.comms.email_j2_sent}
            hint={t("Relance avec liste des 11 docs")}
            tone="var(--warn)"
            icon="✉"
            onClick={() => openDrill("email_j2", t("Email relance J+2"))}
          />
          <CommCard
            label={t("WhatsApp relance J+2")}
            value={data.comms.whatsapp_sent}
            hint={t("Relance en parallèle de l'email")}
            tone="var(--good)"
            icon="◐"
            onClick={() => openDrill("whatsapp_j2", t("WhatsApp relance J+2"))}
          />
          <CommCard
            label={t("Réponses reçues")}
            value={data.comms.responses_received}
            hint={
              data.comms.email_j0_sent > 0
                ? `${t("Taux réponse")} · ${Math.round((data.comms.responses_received / data.comms.email_j0_sent) * 100)}%`
                : `${t("Taux réponse")} · 0%`
            }
            tone="var(--accent-2)"
            icon="↗"
            onClick={() => openDrill("responses", t("Réponses reçues"))}
          />
        </div>
      </div>

      {/* État des dossiers */}
      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          📁 {t("État des dossiers")}
        </div>
        <div className="grid-kpi">
          <CommCard
            label={t("Aucun document")}
            value={data.file_status.no_document}
            hint={t("Email initial envoyé · aucun document reçu")}
            tone="var(--muted)"
            icon="○"
            onClick={() => openDrill("no_document", t("Aucun document"))}
          />
          <CommCard
            label={t("Documents partiels")}
            value={data.file_status.partial}
            hint={t("Au moins un document manquant")}
            tone="var(--warn)"
            icon="◐"
            onClick={() => openDrill("partial", t("Documents partiels"))}
          />
          <CommCard
            label={t("Dossiers complets")}
            value={data.file_status.complete}
            hint={t("BMI, DOB, allergies, traitements, antécédents")}
            tone="var(--good)"
            icon="●"
            onClick={() => openDrill("complete", t("Dossiers complets"))}
          />
          <CommCard
            label={t("Sans réponse 3j+")}
            value={data.file_status.no_response_3d}
            hint={t("Escalade nécessaire")}
            tone="var(--bad)"
            icon="⚠"
            onClick={() => openDrill("pending_3d", t("Sans réponse 3j+"))}
          />
        </div>
      </div>

      {/* Documents à produire par la clinique — parité legacy. */}
      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          🩺 {t("Documents à produire par la clinique")}
        </div>
        <div className="grid-kpi">
          <CommCard
            label={t("Rapport médical")}
            value={data.clinic_docs.medical_report}
            hint={t("Généré")}
            tone="var(--info)"
            icon="📄"
            onClick={() => openDrill("doc_medical_report", t("Rapport médical"))}
          />
          <CommCard
            label={t("Lettre « Undue Delay »")}
            value={data.clinic_docs.undue_delay_letter}
            hint={t("Générée")}
            tone="var(--info)"
            icon="📄"
            onClick={() => openDrill("doc_undue_delay", t("Lettre « Undue Delay »"))}
          />
          <CommCard
            label={t("Déclaration S2 fournisseur")}
            value={data.clinic_docs.s2_provider_declaration}
            hint={t("Signée par la clinique")}
            tone="var(--warn)"
            icon="✈"
            onClick={() => openDrill("doc_s2_declaration", t("Déclaration S2 fournisseur"))}
          />
          <CommCard
            label={t("Devis médical")}
            value={data.clinic_docs.medical_estimate}
            hint={t("Devis de la clinique")}
            tone="var(--warn)"
            icon="📄"
            onClick={() => openDrill("doc_estimate", t("Devis médical"))}
          />
        </div>
      </div>

      {/* Rapport NHS — source : rapport du manager (cf. lib/nhs-report.ts) */}
      <NhsReportSection onOpenCard={(key) => setView({ name: "report-list", key })} />

      {!data.has_data && (
        <div className="card" style={{ borderColor: "var(--warn)", color: "var(--warn)", fontSize: 13 }}>
          ℹ️ {t("Aucune table de leads n'est encore enregistrée pour cette organisation. Les chiffres se rempliront dès le premier appel.")}
        </div>
      )}


    </div>
  );
}


// Renders the seven headline cards from the clinic manager's NHS report
// (total submitted, approved, pending, missing docs, rejected, dropouts, to
// submit). Each card expands inline into the patient list pulled from
// lib/nhs-report.ts. The data is intentionally static — it is the
// authoritative state of the 41 NHS S2 dossiers until backfilled into
// Supabase.
// Card metadata for the 7 report buckets — shared by the dashboard section and
// the dedicated list view so labels and counts stay in sync.
type NhsReportCard = {
  key: NhsReportFilter;
  label: string;
  value: number;
  hint: string;
  tone: string;
  icon: string;
  patients: NhsReportPatient[];
};

function useNhsReportCards(): NhsReportCard[] {
  const t = useT();
  const breakdown = NHS_REPORT_APPROVED_BREAKDOWN;
  const totalPatients = [
    ...NHS_REPORT.approved.patients,
    ...NHS_REPORT.pending_nhs.patients,
    ...NHS_REPORT.missing_docs.patients,
    ...NHS_REPORT.rejected.patients,
    ...NHS_REPORT.dropped_out.patients,
  ];
  return [
    {
      key: "total",
      label: t("Total dossiers"),
      value: NHS_REPORT_TOTAL_SUBMITTED,
      hint: t("soumis au NHS"),
      tone: "var(--info)",
      icon: "▣",
      patients: totalPatients,
    },
    {
      key: "approved",
      label: t("Approuvés"),
      value: NHS_REPORT.approved.patients.length,
      hint: `${breakdown.operated} ${t("opérés")} · ${breakdown.scheduled} ${t("programmés")} · ${breakdown.left_pathway} ${t("sortis du parcours")}`,
      tone: "var(--good)",
      icon: "✓",
      patients: NHS_REPORT.approved.patients,
    },
    {
      key: "pending_nhs",
      label: t("En attente NHS"),
      value: NHS_REPORT.pending_nhs.patients.length,
      hint: t("réponse / appel en cours"),
      tone: "var(--warn)",
      icon: "⌛",
      patients: NHS_REPORT.pending_nhs.patients,
    },
    {
      key: "missing_docs",
      label: t("Éléments requis"),
      value: NHS_REPORT.missing_docs.patients.length,
      hint: t("documents à fournir"),
      tone: "var(--warn)",
      icon: "📄",
      patients: NHS_REPORT.missing_docs.patients,
    },
    {
      key: "rejected",
      label: t("Rejetés"),
      value: NHS_REPORT.rejected.patients.length,
      hint: t("critères ICB non remplis"),
      tone: "var(--bad)",
      icon: "✕",
      patients: NHS_REPORT.rejected.patients,
    },
    {
      key: "dropped_out",
      label: t("Abandons"),
      value: NHS_REPORT.dropped_out.patients.length,
      hint: t("ne souhaitent pas continuer"),
      tone: "var(--muted)",
      icon: "↓",
      patients: NHS_REPORT.dropped_out.patients,
    },
    {
      key: "to_submit",
      label: t("À soumettre"),
      value: NHS_REPORT.to_submit.patients.length,
      hint: t("transmis au NHS en fin de semaine"),
      tone: "var(--accent)",
      icon: "↗",
      patients: NHS_REPORT.to_submit.patients,
    },
  ];
}

function NhsReportSection({
  onOpenCard,
}: {
  onOpenCard: (key: NhsReportFilter) => void;
}) {
  const t = useT();
  const cards = useNhsReportCards();
  const asOf = new Date(NHS_REPORT_AS_OF).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  return (
    <div>
      <div
        className="muted"
        style={{
          fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4,
          marginBottom: 8, display: "flex", justifyContent: "space-between",
          alignItems: "baseline", gap: 8, flexWrap: "wrap",
        }}
      >
        <span>🏥 {t("Rapport NHS — dossiers S2")}</span>
        <span style={{ fontSize: 10, fontStyle: "italic" }}>{t("Mis à jour le")} {asOf}</span>
      </div>
      <div
        className="grid-kpi"
        style={{ gridTemplateColumns: "repeat(7, 1fr)" }}
      >
        {cards.map((c) => (
          <CommCard
            key={c.key}
            label={c.label}
            value={c.value}
            hint={c.hint}
            tone={c.tone}
            icon={c.icon}
            onClick={() => onOpenCard(c.key)}
          />
        ))}
      </div>
    </div>
  );
}

// Full-page patient list for a single NHS report bucket. Same chrome as
// PatientListView: breadcrumb, filter chips (one per bucket so the user can
// jump between them without going back), search, and a table with one row
// per patient. Per-patient document view will be wired once the Google Drive
// → Supabase storage migration completes.
function NhsReportListView({
  reportKey,
  onBack,
  onChangeKey,
  onOpenPatient,
}: {
  reportKey: NhsReportFilter;
  onBack: () => void;
  onChangeKey: (key: NhsReportFilter) => void;
  onOpenPatient: (patient: NhsReportPatient) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const cards = useNhsReportCards();
  const active = cards.find((c) => c.key === reportKey) ?? cards[0];

  const q = search.trim().toLowerCase();
  const filtered = active.patients.filter((p) => {
    if (!q) return true;
    return `${p.name} ${p.situation} ${t(p.situation)} ${p.sent_to_nhs ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Breadcrumb
        items={[
          { label: t("Vue d'ensemble"), onClick: onBack },
          { label: active.label },
        ]}
      />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px", borderRadius: 12,
        background: "rgba(15,18,30,0.6)",
        border: "1px solid rgba(251,191,36,0.18)",
        borderLeft: "4px solid #f59e0b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9, flexShrink: 0,
            background: "rgba(245,158,11,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>📋</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#fff" }}>{active.label}</h2>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999, letterSpacing: 0.4,
                background: "rgba(245,158,11,0.18)", color: "#fcd34d",
              }}>{active.value} {t("patient(s)")}</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7a99" }}>{active.hint}</div>
          </div>
        </div>
        <button onClick={onBack} className="ghost" style={{ padding: "6px 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>←</span> {t("Retour")}
        </button>
      </div>

      {/* Chips for the 7 buckets + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {cards.map((c) => {
          const isActive = reportKey === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onChangeKey(c.key)}
              className={isActive ? "" : "ghost"}
              style={{ padding: "4px 12px", fontSize: 12, borderRadius: 999 }}
            >
              {c.label} ({c.value})
            </button>
          );
        })}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Rechercher…")}
          style={{ marginLeft: "auto", padding: "5px 12px", fontSize: 13, borderRadius: 999, width: "auto", minWidth: 180 }}
        />
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
              <th style={{ width: 4, padding: 0 }} />
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Patient")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Statut")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Envoi NHS")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Situation")}</th>
              <th style={{ textAlign: "right", padding: "10px 14px" }}>{t("Documents")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "14px", textAlign: "center" }} className="muted">
                  {t("Aucun patient trouvé pour ce filtre.")}
                </td>
              </tr>
            )}
            {filtered.map((p, i) => {
              const realCard = cards.find((c) => c.key !== "total" && c.patients.some((x) => x.name === p.name));
              const badgeColor = realCard?.tone ?? "var(--muted)";
              const badgeLabel = realCard?.label ?? "—";
              return (
                <tr
                  key={`${p.name}-${i}`}
                  onClick={() => onOpenPatient(p)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                >
                  <td style={{ padding: 0, width: 4 }}>
                    <div style={{ width: 4, minHeight: 44, height: "100%", background: badgeColor, borderRadius: "4px 0 0 4px" }} />
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar initials={initialsOfName(p.name)} size={28} />
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-flex", padding: "2px 9px", fontSize: 11, fontWeight: 600,
                      borderRadius: 999, whiteSpace: "nowrap",
                      border: `1px solid ${badgeColor}`, color: badgeColor,
                      background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                    }}>
                      {t(badgeLabel)}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }} className="muted">{p.sent_to_nhs ?? "—"}</td>
                  <td style={{ padding: "10px 14px" }}>{t(p.situation)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onOpenPatient(p)}
                      style={{ padding: "3px 12px", fontSize: 12 }}
                    >
                      {t("Voir")} →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function initialsOfName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "—";
}

// ── Report detail view ──────────────────────────────────────────────────────
// Shows all available information for a patient from the static NHS report.
// When Google Drive → Supabase storage migration completes, documents will be
// linked here. Until then this view shows: header, NHS pathway stage, current
// situation, and surgery date if scheduled.
function NhsReportDetailView({
  patient,
  reportKey,
  onBackDashboard,
  onBackList,
}: {
  patient: NhsReportPatient;
  reportKey: NhsReportFilter;
  onBackDashboard: () => void;
  onBackList: () => void;
}) {
  const t = useT();
  const cards = useNhsReportCards();

  // Fetch the matching API patient record by name so we can show the full
  // dossier (checklist, comms, actions) below the NHS report sections.
  const [apiDetail, setApiDetail] = useState<NhsPatientDetail | null>(null);
  const [apiLeadId, setApiLeadId] = useState<string | null>(null);
  const [apiContactId, setApiContactId] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const normName = patient.name.trim().toLowerCase();
    fetch("/api/dashboard/nhs-suivi/patients", { cache: "no-store" })
      .then((r) => r.json())
      .then(async (j: NhsPatientsResponse) => {
        const match = j.patients.find((p) => (p.name ?? "").trim().toLowerCase() === normName);
        if (!match || !alive) { if (alive) setApiLoading(false); return; }
        if (alive) setApiLeadId(match.lead_id);
        // Resolve the Axon contact_id from phone so PatientFullProfile can load
        // CRM data from the main DB (legacy lead_id is from a different database).
        if (match.phone) {
          fetch(`/api/desk/contact-by-phone?e164=${encodeURIComponent(match.phone)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j2: { contact?: { id: string } | null }) => {
              if (alive && j2.contact?.id) setApiContactId(j2.contact.id);
            })
            .catch(() => {});
        }
        const r2 = await fetch(`/api/dashboard/nhs-suivi/patients/${encodeURIComponent(match.lead_id)}`, { cache: "no-store" });
        const detail = (await r2.json()) as NhsPatientDetail;
        if (alive) { setApiDetail(detail); setApiLoading(false); }
      })
      .catch(() => alive && setApiLoading(false));
    return () => { alive = false; };
  }, [patient.name]);

  // Map category to a descriptive NHS pathway stage label and colour.
  const STAGE_META: Record<NhsReportFilter, { label: string; color: string }> = {
    total:        { label: t("Dossier soumis"),             color: "var(--info)" },
    approved:     { label: t("Approuvé — voie S2"),         color: "var(--good)" },
    pending_nhs:  { label: t("En attente de réponse NHS"),  color: "var(--warn)" },
    missing_docs: { label: t("Éléments manquants requis"),  color: "var(--warn)" },
    rejected:     { label: t("Rejeté — critères ICB"),      color: "var(--bad)"  },
    dropped_out:  { label: t("Abandon du parcours"),        color: "var(--muted)"},
    to_submit:    { label: t("Prêt à soumettre"),           color: "var(--accent)"},
  };

  // Look up the patient's real bucket from NHS_REPORT by name so that the
  // category shown is always correct, regardless of which filter the user
  // drilled in from (e.g. "total" would otherwise hide the real status).
  // Comparison is case-insensitive + trimmed to survive any whitespace/case
  // inconsistency between the static data and the patient object passed in.
  const NHS_REAL_KEYS: NhsReportKey[] = ["approved", "pending_nhs", "missing_docs", "rejected", "dropped_out", "to_submit"];
  const normName = patient.name.trim().toLowerCase();
  const realKey: NhsReportFilter = NHS_REAL_KEYS.find(
    (k) => NHS_REPORT[k].patients.some((p) => p.name.trim().toLowerCase() === normName)
  ) ?? (reportKey === "total" ? "approved" : reportKey);

  const card = cards.find((c) => c.key === realKey);
  const categoryLabel = card?.label ?? t("Rapport NHS");

  // Determine which pathway steps are complete based on the patient's real category.
  const isApproved    = realKey === "approved";
  const isPending     = realKey === "pending_nhs";
  const isSubmitted   = isApproved || isPending || realKey === "missing_docs" || realKey === "rejected";
  const isOperated    = isApproved && patient.situation.startsWith("Opéré");
  const isScheduled   = !!patient.surgery_when;

  // Refine the badge label for approved patients to show their exact sub-status.
  const stageBase = STAGE_META[realKey] ?? STAGE_META.total;
  const stage = isOperated
    ? { ...stageBase, label: t("Approuvé & Opéré") }
    : isApproved && isScheduled
    ? { ...stageBase, label: t("Approuvé — opération planifiée") }
    : isApproved
    ? { ...stageBase, label: t("Approuvé — voie S2") }
    : stageBase;

  const crumbs = [
    { label: t("Vue d'ensemble"), onClick: onBackDashboard },
    { label: cards.find((c) => c.key === (reportKey === "total" ? realKey : reportKey))?.label ?? t("Rapport NHS"), onClick: onBackList },
    { label: patient.name },
  ];

  const journey: Array<{ label: string; done: boolean; active: boolean }> = [
    { label: t("Dossier préparé"),    done: true,          active: false },
    { label: t("Soumis au NHS"),      done: isSubmitted,   active: !isSubmitted },
    { label: t("En examen NHS"),      done: isApproved || realKey === "rejected", active: isPending },
    { label: t("Approuvé"),           done: isApproved,    active: false },
    { label: t("Opération planifiée"), done: isApproved,   active: isApproved && !isOperated },
    { label: t("Opéré"),              done: isOperated,    active: false },
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Breadcrumb items={crumbs} />

      {/* Header */}
      <div className="card" style={{
        padding: 18,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
        borderLeft: `4px solid ${stage.color}`,
        background: `color-mix(in srgb, ${stage.color} 6%, var(--bg-2))`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <Avatar initials={initialsOfName(patient.name)} size={52} />
          <div>
            <h3 style={{ margin: 0, fontSize: 20 }}>{patient.name}</h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {t("Dossier NHS S2")}
              {patient.sent_to_nhs && ` · ${t("Envoyé le")} ${patient.sent_to_nhs}`}
            </div>
          </div>
        </div>
        <span
          style={{
            padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 999,
            border: `1px solid ${stage.color}`,
            color: stage.color,
            background: `color-mix(in srgb, ${stage.color} 12%, transparent)`,
            whiteSpace: "nowrap",
          }}
        >
          {stage.label}
        </span>
      </div>

      {/* NHS S2 Pathway */}
      <div className="card" style={{ padding: "22px 24px" }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 24, fontWeight: 600 }}>
          {t("Parcours NHS S2")}
        </div>
        <div style={{ display: "flex", paddingBottom: 8 }}>
          {journey.map((step, i) => {
            const isDone = step.done;
            const isActive = step.active;
            const dotBg = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#1e2535";
            const dotBorder = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#3b4560";
            const dotColor = isDone ? "#fff" : isActive ? "#1a1200" : "#6b7a99";
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                {i < journey.length - 1 && (
                  <div style={{ position: "absolute", top: 17, left: "50%", right: "-50%", height: 3, borderRadius: 2, background: isDone ? "var(--good)" : "#2a3248" }} />
                )}
                <div
                  style={{
                    width: 34, height: 34, borderRadius: "50%", zIndex: 1, fontSize: 13, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: `2px solid ${dotBorder}`,
                    background: dotBg,
                    color: dotColor,
                    boxShadow: isActive ? `0 0 0 4px rgba(251,191,36,0.18)` : isDone ? `0 0 0 3px rgba(74,222,128,0.12)` : "none",
                  }}
                >
                  {isDone ? "✓" : isActive ? "●" : String(i + 1)}
                </div>
                <div style={{
                  fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 1.3,
                  color: isDone ? "var(--good)" : isActive ? "var(--warn)" : "#6b7a99",
                  fontWeight: isDone ? 600 : isActive ? 600 : 400,
                  maxWidth: 80,
                }}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Situation + Submission details — side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card" style={{ padding: "12px 16px" }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            {t("Situation actuelle")}
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{t(patient.situation)}</p>
          {patient.surgery_when && (
            <div
              style={{
                marginTop: 10, padding: "8px 12px", borderRadius: 8,
                background: "color-mix(in srgb, var(--good) 10%, var(--bg-2))",
                border: "1px solid color-mix(in srgb, var(--good) 30%, transparent)",
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <span style={{ fontSize: 16 }}>📅</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--good)" }}>{t("Opération planifiée")}</div>
                <div className="muted" style={{ fontSize: 11 }}>{patient.surgery_when}</div>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "12px 16px" }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            {t("Détails de la soumission NHS")}
          </div>
          <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span className="muted" style={{ minWidth: 110 }}>{t("Catégorie")}</span>
              <span style={{ fontWeight: 600, color: stage.color }}>{stage.label}</span>
            </div>
            {patient.sent_to_nhs && (
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span className="muted" style={{ minWidth: 110 }}>{t("Envoi au NHS")}</span>
                <span>{patient.sent_to_nhs}</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span className="muted" style={{ minWidth: 110 }}>{t("Rapport du")}</span>
              <span>{new Date(NHS_REPORT_AS_OF).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Documents — placeholder until upload */}
      <div className="card" style={{ padding: "12px 16px" }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          {t("Documents")}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          {t("Les documents seront accessibles ici après l'upload depuis Google Drive.")}
        </p>
      </div>

      {/* ── API dossier sections ── loaded by name lookup from nhs-suivi/patients */}
      {apiLoading && (
        <div className="card" style={{ padding: "12px 16px" }}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("Chargement du dossier…")}</p>
        </div>
      )}
      {!apiLoading && apiDetail && (() => {
        const { patient: ap, documents, timeline } = apiDetail;
        const docPct = ap.docs_required > 0 ? Math.round((ap.docs_received / ap.docs_required) * 100) : 0;
        const docComplete = ap.docs_received >= ap.docs_required;
        const TLTONE: Record<string, string> = {
          call: "var(--info)", email: "var(--warn)", whatsapp: "var(--good)", doc: "var(--muted)", response: "var(--good)",
        };

        const docJourney: Array<{ label: string; done: boolean; active: boolean }> = [
          { label: t("Appel initial"),      done: !!ap.last_activity, active: false },
          { label: t("Email explicatif"),   done: ap.status !== "aucun-doc" || timeline.some((x) => x.kind === "email"), active: false },
          { label: t("Relance J+2"),        done: timeline.some((x) => x.title_key === "Email relance J+2"), active: false },
          { label: t("Documents en cours"), done: docComplete, active: ap.status === "partiels" || ap.status === "aucun-doc" },
          { label: t("Dossier complet"),    done: ap.status === "complets" || ap.status === "envoye-nhs", active: ap.status === "complets" },
          { label: t("Envoyé NHS"),         done: ap.status === "envoye-nhs", active: ap.status === "envoye-nhs" && !ap.nhs_status },
        ];

        return (
          <>
            {/* Document-collection journey */}
            <div className="card" style={{ padding: "22px 24px" }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 24, fontWeight: 600 }}>
                {t("Progression du parcours patient")}
              </div>
              <div style={{ display: "flex", paddingBottom: 8 }}>
                {docJourney.map((step, i) => {
                  const isDone = step.done;
                  const isActive = step.active;
                  const dotBg     = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#1e2535";
                  const dotBorder = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#3b4560";
                  const dotColor  = isDone ? "#fff"        : isActive ? "#1a1200"    : "#6b7a99";
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                      {i < docJourney.length - 1 && (
                        <div style={{ position: "absolute", top: 17, left: "50%", right: "-50%", height: 3, borderRadius: 2, background: isDone ? "var(--good)" : "#2a3248" }} />
                      )}
                      <div style={{
                        width: 34, height: 34, borderRadius: "50%", zIndex: 1, fontSize: 13, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: `2px solid ${dotBorder}`, background: dotBg, color: dotColor,
                        boxShadow: isActive ? "0 0 0 4px rgba(251,191,36,0.18)" : isDone ? "0 0 0 3px rgba(74,222,128,0.12)" : "none",
                      }}>
                        {isDone ? "✓" : isActive ? "●" : String(i + 1)}
                      </div>
                      <div style={{ fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 1.3, color: isDone ? "var(--good)" : isActive ? "var(--warn)" : "#6b7a99", fontWeight: isDone || isActive ? 600 : 400, maxWidth: 80 }}>
                        {step.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Checklist + Communications */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
              <div className="card" style={{ padding: 18 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                  {t("Checklist — 11 documents NHS S2")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1, height: 6, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ width: `${docPct}%`, height: "100%", background: docComplete ? "var(--good)" : docPct < 50 ? "var(--bad)" : "var(--warn)" }} />
                  </div>
                  <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    {ap.docs_received} / {ap.docs_required} {t("obligatoires")}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: docComplete ? "var(--good)" : "var(--warn)" }}>
                    {docComplete ? t("Complet") : t("Incomplet")}
                  </span>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {documents.map((doc) => {
                    const tag = !doc.required ? "optional" : doc.received ? "received" : "pending";
                    const tone = tag === "received" ? "var(--good)" : tag === "optional" ? "var(--warn)" : "var(--muted)";
                    const tagLabel = tag === "received" ? t("Reçu") : tag === "optional" ? t("Optionnel") : t("En attente");
                    return (
                      <div key={doc.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)" }}>
                        <span style={{ width: 18, textAlign: "center", color: tone, fontWeight: 700 }}>
                          {tag === "received" ? "✓" : tag === "optional" ? "○" : "·"}
                        </span>
                        <span style={{ flex: 1, fontSize: 12 }}>{t(DOC_LABEL[doc.key] ?? doc.key)}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: tone }}>{tagLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                  {t("Historique des communications")}
                </div>
                {timeline.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("Aucune communication enregistrée.")}</p>
                ) : (
                  <div style={{ display: "grid", gap: 2 }}>
                    {timeline.map((item, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none", fontSize: 12 }}>
                        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, marginTop: 5, flexShrink: 0, background: TLTONE[item.kind] ?? "var(--muted)" }} />
                        <span className="muted" style={{ whiteSpace: "nowrap", minWidth: 95 }}>
                          {new Date(item.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>{t(item.title_key)}</span>
                          {item.detail && <span className="muted"> · {item.detail}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* NHS S2 Status */}
            <div className="card" style={{ padding: 18 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                {t("Statut NHS S2")}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["envoye-nhs", "in_review", "additional_info", "accepted", "refused"].map((s) => {
                  const isActive = ap.nhs_status === s || (s === "envoye-nhs" && ap.status === "envoye-nhs");
                  const label = s === "envoye-nhs" ? t("Envoyé NHS") : t(NHS_BADGE_LABEL[s] ?? s);
                  return (
                    <span key={s} style={{
                      padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: 999,
                      border: `1px solid ${isActive ? "var(--info)" : "var(--border)"}`,
                      color: isActive ? "var(--info)" : "var(--muted)",
                      background: isActive ? "color-mix(in srgb, var(--info) 12%, transparent)" : "transparent",
                    }}>
                      {label}
                    </span>
                  );
                })}
              </div>
              {ap.status !== "envoye-nhs" && (
                <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                  {t("Dossier pas encore soumis à la NHS.")}
                </p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="card" style={{ padding: 18 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                {t("Actions rapides")}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="ghost" disabled style={{ padding: "6px 12px", fontSize: 12, opacity: 0.6 }}>✉ {t("Relancer par email")}</button>
                <button type="button" className="ghost" disabled style={{ padding: "6px 12px", fontSize: 12, opacity: 0.6 }}>◐ {t("Relancer WhatsApp")}</button>
                <button type="button" disabled={!docComplete} style={{ padding: "6px 12px", fontSize: 12, opacity: docComplete ? 1 : 0.5 }}>↗ {t("Soumettre à la NHS")}</button>
              </div>
            </div>

            {/* Escalation */}
            {ap.escalade && (
              <div className="card" style={{ padding: 18, borderColor: "var(--bad)", background: "color-mix(in srgb, var(--bad) 8%, var(--panel))" }}>
                <div style={{ fontWeight: 600, color: "var(--bad)" }}>{t("Escalade requise — Aucune réponse depuis 3 jours+")}</div>
                <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>{t("Assigner ce patient à un coordinateur pour un suivi humain.")}</p>
              </div>
            )}
          </>
        );
      })()}

      {/* Full CRM profile — loaded via Axon contact_id resolved from phone */}
      {apiContactId && <PatientFullProfile contactId={apiContactId} />}
    </div>
  );
}

function AlertRow({
  tone, icon, title, subtitle, value, ctaLabel, ctaHref, onCta,
}: {
  tone: "bad" | "good" | "warn";
  icon: string;
  title: string;
  subtitle: string;
  value: number;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
}) {
  const color = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--good)";
  const softBg = `color-mix(in srgb, ${color} 10%, var(--panel))`;
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, background: softBg, borderColor: color }}>
      <div
        style={{
          width: 36, height: 36, borderRadius: "50%", background: color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color }}>{title}</div>
        <div className="muted" style={{ fontSize: 13 }}>{subtitle}</div>
        {ctaLabel && ctaHref && (
          <a href={ctaHref} style={{ color, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
            {ctaLabel} ›
          </a>
        )}
        {ctaLabel && !ctaHref && onCta && (
          <button
            type="button"
            onClick={onCta}
            style={{
              color, fontSize: 12, fontWeight: 600, background: "none",
              border: "none", padding: 0, cursor: "pointer",
            }}
          >
            {ctaLabel} ›
          </button>
        )}
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function CommCard({
  label, value, hint, tone, icon, onClick,
}: {
  label: string;
  value: number;
  hint: string;
  tone: string;
  icon: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
        <span style={{ fontSize: 14, color: tone }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: tone }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
    </>
  );
  if (!onClick) return <div className="card" style={{ padding: 14 }}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card"
      style={{
        padding: 14, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit",
        transition: "transform 120ms, box-shadow 120ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.18)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      {inner}
    </button>
  );
}

// ── Patient list + detail (port of the legacy 3-view NHS page) ─────────────

type PatientFilter = PatientStatus | "all" | "has-response" | "no-docs";
type NhsReportFilter = NhsReportKey | "total";

type NhsView =
  | { name: "dashboard" }
  | { name: "list"; filter: PatientFilter }
  | { name: "report-list"; key: NhsReportFilter }
  | { name: "detail"; id: string; from: PatientFilter }
  | { name: "report-detail"; patient: NhsReportPatient; reportKey: NhsReportFilter }
  | { name: "contact-detail"; contactId: string; displayName: string };

const STATUS_TONE: Record<PatientStatus, string> = {
  "complets": "var(--good)",
  "partiels": "var(--warn)",
  "sans-reponse": "var(--bad)",
  "aucun-doc": "var(--muted)",
  "envoye-nhs": "var(--info)",
};
const STATUS_LABEL: Record<PatientStatus, string> = {
  "complets": "Complet",
  "partiels": "Partiel",
  "sans-reponse": "Sans réponse 3j+",
  "aucun-doc": "Aucun doc",
  "envoye-nhs": "Envoyé NHS",
};
const FILTER_LABEL: Record<PatientFilter, string> = {
  "all": "Tous les patients",
  "sans-reponse": "Sans réponse 3j+ — Escalade requise",
  "complets": "Dossiers complets — Prêts pour la NHS",
  "partiels": "Documents partiels",
  "aucun-doc": "Aucun document reçu",
  "envoye-nhs": "Envoyés NHS S2",
  "has-response": "Réponses reçues",
  "no-docs": "Aucun document reçu",
};
const NHS_BADGE_LABEL: Record<string, string> = {
  in_review: "In review",
  additional_info: "Demande additionnelle",
  accepted: "Accepté",
  refused: "Refusé",
};
const DOC_LABEL: Record<string, string> = {
  doc_nhs_s2_form: "NHS S2 Form",
  doc_s2_provider_declaration: "S2 Provider Declaration Form",
  doc_cpam_certificate: "CPAM Certificate",
  doc_clinical_justification_gp: "Lettre de justification clinique (GP)",
  doc_medical_report: "Rapport médical",
  doc_undue_delay_letter: "« Undue Delay » — rationale",
  doc_patient_authorisation: "Autorisation patient",
  doc_identity_document: "Pièce d'identité",
  doc_proof_of_residence: "Justificatif de domicile",
  doc_bank_statements: "Relevés bancaires",
  doc_detailed_medical_estimate: "Devis médical détaillé",
};

function StatusBadge({ status }: { status: PatientStatus }) {
  const t = useT();
  const tone = STATUS_TONE[status];
  return (
    <span
      style={{
        display: "inline-flex", padding: "2px 9px", fontSize: 11, fontWeight: 600,
        borderRadius: 999, border: `1px solid ${tone}`, color: tone, whiteSpace: "nowrap",
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
      }}
    >
      {t(STATUS_LABEL[status])}
    </span>
  );
}

function Breadcrumb({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span className="muted">›</span>}
          {it.onClick ? (
            <button
              type="button"
              onClick={it.onClick}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", font: "inherit", fontSize: 13 }}
            >
              {it.label}
            </button>
          ) : (
            <span style={{ fontWeight: 600 }}>{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "color-mix(in srgb, var(--info) 16%, transparent)",
        color: "var(--info)", fontWeight: 700, fontSize: size > 40 ? 18 : 12,
        border: size > 40 ? "2px solid color-mix(in srgb, var(--info) 40%, transparent)" : "none",
      }}
    >
      {initials}
    </span>
  );
}

// ── View 2: patient list ────────────────────────────────────────────────────

function PatientListView({
  filter, onBack, onChangeFilter, onOpenPatient,
}: {
  filter: PatientFilter;
  onBack: () => void;
  onChangeFilter: (f: PatientFilter) => void;
  onOpenPatient: (id: string) => void;
}) {
  const t = useT();
  const [patients, setPatients] = useState<NhsPatient[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/dashboard/nhs-suivi/patients", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as NhsPatientsResponse & { error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) { setPatients(j.patients); setError(null); }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = (patients ?? []).filter((p) => {
    if (filter === "has-response" && !p.has_response) return false;
    if (filter === "no-docs" && p.docs_received !== 0) return false;
    if (filter !== "all" && filter !== "has-response" && filter !== "no-docs" && p.status !== filter) return false;
    if (!q) return true;
    return `${p.name ?? ""} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase().includes(q);
  });

  const chips: Array<{ id: PatientFilter; label: string }> = [
    { id: "all", label: t("Tous") },
    { id: "sans-reponse", label: t("Sans réponse") },
    { id: "partiels", label: t("Partiels") },
    { id: "complets", label: t("Complets") },
    { id: "envoye-nhs", label: t("Envoyés NHS") },
  ];

  const fmtActivity = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Breadcrumb
        items={[
          { label: t("Vue d'ensemble"), onClick: onBack },
          { label: t(FILTER_LABEL[filter]) },
        ]}
      />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px", borderRadius: 12,
        background: "rgba(15,18,30,0.6)",
        border: "1px solid rgba(59,130,246,0.18)",
        borderLeft: "4px solid #3b82f6",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9, flexShrink: 0,
            background: "rgba(59,130,246,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>👥</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#fff" }}>{t("Liste des patients")}</h2>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, letterSpacing: 0.5,
                background: "rgba(59,130,246,0.18)", color: "#93c5fd",
              }}>NHS S2</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7a99" }}>{t("Cliquer sur un patient pour accéder à la fiche dossier complète")}</div>
          </div>
        </div>
        <button onClick={onBack} className="ghost" style={{ padding: "6px 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>←</span> {t("Retour")}
        </button>
      </div>

      {/* Filter chips + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {chips.map((c) => {
          const active = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChangeFilter(c.id)}
              className={active ? "" : "ghost"}
              style={{ padding: "4px 12px", fontSize: 12, borderRadius: 999 }}
            >
              {c.label}
            </button>
          );
        })}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Rechercher…")}
          style={{ marginLeft: "auto", padding: "5px 12px", fontSize: 13, borderRadius: 999, width: "auto", minWidth: 180 }}
        />
      </div>

      {error && <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
              <th style={{ width: 4, padding: 0 }} />
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Patient")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Statut")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px", minWidth: 160 }}>{t("Documents")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Dernière activité")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Statut NHS")}</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="muted" style={{ padding: "24px 14px", textAlign: "center" }}>{t("Chargement…")}</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: "24px 14px", textAlign: "center" }}>{t("Aucun patient trouvé pour ce filtre.")}</td></tr>
            )}
            {filtered.map((p) => {
              const pct = p.docs_required > 0 ? Math.round((p.docs_received / p.docs_required) * 100) : 0;
              const fill = p.status === "complets" ? "var(--good)" : pct < 50 ? "var(--bad)" : "var(--warn)";
              const rowAccent = STATUS_TONE[p.status];
              return (
                <tr
                  key={p.id}
                  onClick={() => onOpenPatient(p.id)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                >
                  <td style={{ padding: 0, width: 4 }}>
                    <div style={{ width: 4, height: "100%", minHeight: 44, background: rowAccent, borderRadius: "4px 0 0 4px" }} />
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar initials={p.initials} />
                      <div>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          {p.name ?? "—"}
                          {p.duplicate && (
                            <span
                              title={t("Ce numéro de téléphone apparaît sur plusieurs dossiers")}
                              style={{
                                fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
                                background: "color-mix(in srgb, var(--warn) 15%, transparent)",
                                color: "var(--warn)", border: "1px solid var(--warn)", whiteSpace: "nowrap",
                              }}
                            >
                              {t("doublon")}
                            </span>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {p.age != null ? `${p.age} ${t("ans")}` : ""}
                          {p.phone ? `${p.age != null ? " · " : ""}${p.phone}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}><StatusBadge status={p.status} /></td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: fill }} />
                      </div>
                      <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                        {p.docs_received}/{p.docs_required}
                      </span>
                    </div>
                  </td>
                  <td className="muted" style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmtActivity(p.last_activity)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {p.nhs_status ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--info)" }}>
                        {t(NHS_BADGE_LABEL[p.nhs_status] ?? p.nhs_status)}
                      </span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td style={{ padding: "10px 14px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {p.escalade && (
                        <button type="button" className="ghost" onClick={() => onOpenPatient(p.id)} style={{ padding: "3px 9px", fontSize: 11, color: "var(--bad)", borderColor: "var(--bad)" }}>
                          {t("Escalade")}
                        </button>
                      )}
                      <button type="button" className="ghost" onClick={() => onOpenPatient(p.id)} style={{ padding: "3px 9px", fontSize: 11 }}>
                        {t("Voir")} →
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── View 3: patient detail ──────────────────────────────────────────────────

function PatientDetailView({
  id, fromFilter, onBackDashboard, onBackList,
}: {
  id: string;
  fromFilter: PatientFilter;
  onBackDashboard: () => void;
  onBackList: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<NhsPatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignedMsg, setAssignedMsg] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/dashboard/nhs-suivi/patients/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as NhsPatientDetail & { error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) { setDetail(j); setError(null); }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  // Resolve Axon contact_id from phone so PatientFullProfile can show CRM data.
  // The NHS patient id is from the legacy DB; patient-row expects main DB contact_id.
  useEffect(() => {
    if (!detail?.patient.phone) return;
    let alive = true;
    fetch(`/api/desk/contact-by-phone?e164=${encodeURIComponent(detail.patient.phone)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { contact?: { id: string } | null }) => {
        if (alive && j.contact?.id) setContactId(j.contact.id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [detail?.patient.phone]);

  // coordinator = null → désassignation (ferme l'assignation ouverte).
  const assign = async (coordinator: string | null) => {
    if (!detail) return;
    setAssigning(coordinator ?? "__unassign__");
    setAssignedMsg(null);
    try {
      const r = await fetch("/api/dashboard/nhs-suivi/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          coordinator
            ? { lead_id: detail.patient.lead_id, assigned_to: coordinator, reason: "Escalade NHS S2 — sans réponse 3j+" }
            : { lead_id: detail.patient.lead_id, unassign: true },
        ),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAssignedMsg(coordinator ? `${t("Assigné à")} ${coordinator} ✓` : `${t("Désassigné")} ✓`);
    } catch (e) {
      setAssignedMsg(e instanceof Error ? e.message : "error");
    } finally {
      setAssigning(null);
    }
  };

  const crumbs = [
    { label: t("Vue d'ensemble"), onClick: onBackDashboard },
    { label: t(FILTER_LABEL[fromFilter]), onClick: onBackList },
    { label: detail?.patient.name ?? "…" },
  ];

  if (loading || !detail) {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <Breadcrumb items={crumbs} />
        {error
          ? <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>
          : <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement du dossier…")}</p></div>}
      </div>
    );
  }

  const { patient, documents, timeline } = detail;
  const docPct = patient.docs_required > 0 ? Math.round((patient.docs_received / patient.docs_required) * 100) : 0;
  const docComplete = patient.docs_received >= patient.docs_required;

  // Parcours patient — same 6 steps as the legacy detail page.
  const journey: Array<{ label: string; done: boolean; active: boolean }> = [
    { label: t("Appel initial"), done: !!patient.last_activity, active: false },
    { label: t("Email explicatif"), done: patient.status !== "aucun-doc" || timeline.some((x) => x.kind === "email"), active: false },
    { label: t("Relance J+2"), done: timeline.some((x) => x.title_key === "Email relance J+2"), active: false },
    { label: t("Documents en cours"), done: docComplete, active: patient.status === "partiels" || patient.status === "aucun-doc" },
    { label: t("Dossier complet"), done: patient.status === "complets" || patient.status === "envoye-nhs", active: patient.status === "complets" },
    { label: t("Envoyé NHS"), done: patient.status === "envoye-nhs", active: patient.status === "envoye-nhs" && !patient.nhs_status },
  ];

  const TIMELINE_TONE: Record<string, string> = {
    call: "var(--info)", email: "var(--warn)", whatsapp: "var(--good)", doc: "var(--muted)", response: "var(--good)",
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Breadcrumb items={crumbs} />

      {/* Header */}
      <div className="card" style={{ padding: 18, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <Avatar initials={patient.initials} size={52} />
          <div>
            <h3 style={{ margin: 0, fontSize: 20 }}>{patient.name ?? "—"}</h3>
            <div className="muted" style={{ display: "flex", gap: 12, fontSize: 12, marginTop: 4, flexWrap: "wrap" }}>
              {patient.age != null && <span>👤 {patient.age} {t("ans")}</span>}
              {patient.phone && <span>☎ {patient.phone}</span>}
              {patient.email && <span>@ {patient.email}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <StatusBadge status={patient.status} />
          {patient.bank_exception && (
            <span style={{ fontSize: 11, color: "var(--warn)" }}>⚑ {t("Exception relevés bancaires")}</span>
          )}
          {patient.last_activity && (
            <span className="muted" style={{ fontSize: 11 }}>
              📅 {new Date(patient.last_activity).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
      </div>

      {/* Parcours — horizontal step timeline */}
      <div className="card" style={{ padding: "22px 24px" }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 24, fontWeight: 600 }}>
          {t("Progression du parcours patient")}
        </div>
        <div style={{ display: "flex", paddingBottom: 8 }}>
          {journey.map((step, i) => {
            const isDone = step.done;
            const isActive = step.active;
            const dotBg = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#1e2535";
            const dotBorder = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#3b4560";
            const dotColor = isDone ? "#fff" : isActive ? "#1a1200" : "#6b7a99";
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                {i < journey.length - 1 && (
                  <div style={{ position: "absolute", top: 17, left: "50%", right: "-50%", height: 3, borderRadius: 2, background: isDone ? "var(--good)" : "#2a3248" }} />
                )}
                <div style={{
                  width: 34, height: 34, borderRadius: "50%", zIndex: 1, fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `2px solid ${dotBorder}`, background: dotBg, color: dotColor,
                  boxShadow: isActive ? "0 0 0 4px rgba(251,191,36,0.18)" : isDone ? "0 0 0 3px rgba(74,222,128,0.12)" : "none",
                }}>
                  {isDone ? "✓" : isActive ? "●" : String(i + 1)}
                </div>
                <div style={{
                  fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 1.3,
                  color: isDone ? "var(--good)" : isActive ? "var(--warn)" : "#6b7a99",
                  fontWeight: isDone || isActive ? 600 : 400,
                  maxWidth: 80,
                }}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* NHS S2 Pathway — injected when this patient has a record in the static NHS report */}
      {(() => {
        const NHS_KEYS: NhsReportKey[] = ["approved", "pending_nhs", "missing_docs", "rejected", "dropped_out", "to_submit"];
        const normName = (patient.name ?? "").trim().toLowerCase();
        const nhsKey = NHS_KEYS.find((k) => NHS_REPORT[k].patients.some((p) => p.name.trim().toLowerCase() === normName));
        if (!nhsKey) return null;
        const nhsPt = NHS_REPORT[nhsKey].patients.find((p) => p.name.trim().toLowerCase() === normName)!;

        const nhsApproved  = nhsKey === "approved";
        const nhsPending   = nhsKey === "pending_nhs";
        const nhsSubmitted = nhsApproved || nhsPending || nhsKey === "missing_docs" || nhsKey === "rejected";
        const nhsOperated  = nhsApproved && nhsPt.situation.startsWith("Opéré");
        const nhsScheduled = !!nhsPt.surgery_when;

        const TONE: Record<string, string> = {
          approved: "var(--good)", pending_nhs: "var(--warn)", missing_docs: "var(--warn)",
          rejected: "var(--bad)", dropped_out: "var(--muted)", to_submit: "var(--accent)",
        };
        const nhsColor = TONE[nhsKey] ?? "var(--muted)";
        const nhsLabel = nhsApproved && nhsOperated
          ? t("Approuvé & Opéré")
          : nhsApproved && nhsScheduled
          ? t("Approuvé — opération planifiée")
          : nhsApproved
          ? t("Approuvé — voie S2")
          : nhsKey === "pending_nhs"  ? t("En attente de réponse NHS")
          : nhsKey === "missing_docs" ? t("Éléments manquants requis")
          : nhsKey === "rejected"     ? t("Rejeté — critères ICB")
          : nhsKey === "dropped_out"  ? t("Abandon du parcours")
          : t("Prêt à soumettre");

        const nhsJourney = [
          { label: t("Dossier préparé"),     done: true,         active: false },
          { label: t("Soumis au NHS"),       done: nhsSubmitted, active: !nhsSubmitted },
          { label: t("En examen NHS"),       done: nhsApproved || nhsKey === "rejected", active: nhsPending },
          { label: t("Approuvé"),            done: nhsApproved,  active: false },
          { label: t("Opération planifiée"), done: nhsApproved,  active: nhsApproved && !nhsOperated },
          { label: t("Opéré"),               done: nhsOperated,  active: false },
        ];

        return (
          <div className="card" style={{
            padding: "18px 24px",
            borderLeft: `4px solid ${nhsColor}`,
            background: `color-mix(in srgb, ${nhsColor} 5%, var(--bg-2))`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
                🏥 {t("Parcours NHS S2")}
              </div>
              <span style={{
                padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 999,
                border: `1px solid ${nhsColor}`, color: nhsColor,
                background: `color-mix(in srgb, ${nhsColor} 12%, transparent)`,
              }}>
                {nhsLabel}
              </span>
            </div>
            <div style={{ display: "flex", paddingBottom: 8 }}>
              {nhsJourney.map((step, i) => {
                const isDone = step.done;
                const isActive = step.active;
                const dotBg     = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#1e2535";
                const dotBorder = isDone ? "var(--good)" : isActive ? "var(--warn)" : "#3b4560";
                const dotColor  = isDone ? "#fff"        : isActive ? "#1a1200"    : "#6b7a99";
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                    {i < nhsJourney.length - 1 && (
                      <div style={{ position: "absolute", top: 17, left: "50%", right: "-50%", height: 3, borderRadius: 2, background: isDone ? "var(--good)" : "#2a3248" }} />
                    )}
                    <div style={{
                      width: 34, height: 34, borderRadius: "50%", zIndex: 1, fontSize: 13, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: `2px solid ${dotBorder}`, background: dotBg, color: dotColor,
                      boxShadow: isActive ? "0 0 0 4px rgba(251,191,36,0.18)" : isDone ? "0 0 0 3px rgba(74,222,128,0.12)" : "none",
                    }}>
                      {isDone ? "✓" : isActive ? "●" : String(i + 1)}
                    </div>
                    <div style={{ fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 1.3, color: isDone ? "var(--good)" : isActive ? "var(--warn)" : "#6b7a99", fontWeight: isDone || isActive ? 600 : 400, maxWidth: 80 }}>
                      {step.label}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
              <div style={{ background: "var(--bg-2)", borderRadius: 8, padding: "12px 14px" }}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{t("Situation actuelle")}</div>
                <div style={{ fontSize: 13 }}>{t(nhsPt.situation)}</div>
              </div>
              <div style={{ background: "var(--bg-2)", borderRadius: 8, padding: "12px 14px" }}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{t("Détails de la soumission NHS")}</div>
                <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span className="muted" style={{ minWidth: 90 }}>{t("Catégorie")}</span>
                    <span style={{ fontWeight: 600, color: nhsColor }}>{nhsLabel}</span>
                  </div>
                  {nhsPt.sent_to_nhs && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <span className="muted" style={{ minWidth: 90 }}>{t("Envoi au NHS")}</span>
                      <span>{nhsPt.sent_to_nhs}</span>
                    </div>
                  )}
                  {nhsPt.surgery_when && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <span className="muted" style={{ minWidth: 90 }}>{t("Opération planifiée")}</span>
                      <span style={{ color: "var(--good)", fontWeight: 600 }}>{nhsPt.surgery_when}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {/* Checklist 11 documents */}
        <div className="card" style={{ padding: 18 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
            {t("Checklist — 11 documents NHS S2")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 6, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${docPct}%`, height: "100%", background: docComplete ? "var(--good)" : docPct < 50 ? "var(--bad)" : "var(--warn)" }} />
            </div>
            <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {patient.docs_received} / {patient.docs_required} {t("obligatoires")}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: docComplete ? "var(--good)" : "var(--warn)" }}>
              {docComplete ? t("Complet") : t("Incomplet")}
            </span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {documents.map((doc) => {
              const tag = !doc.required ? "optional" : doc.received ? "received" : "pending";
              const tone = tag === "received" ? "var(--good)" : tag === "optional" ? "var(--warn)" : "var(--muted)";
              const tagLabel = tag === "received" ? t("Reçu") : tag === "optional" ? t("Optionnel") : t("En attente");
              return (
                <div key={doc.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)" }}>
                  <span style={{ width: 18, textAlign: "center", color: tone, fontWeight: 700 }}>
                    {tag === "received" ? "✓" : tag === "optional" ? "○" : "·"}
                  </span>
                  <span style={{ flex: 1, fontSize: 12 }}>{t(DOC_LABEL[doc.key] ?? doc.key)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: tone }}>{tagLabel}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Historique des communications */}
        <div className="card" style={{ padding: 18 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
            {t("Historique des communications")}
          </div>
          {timeline.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("Aucune communication enregistrée.")}</p>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {timeline.map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none", fontSize: 12 }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, marginTop: 5, flexShrink: 0, background: TIMELINE_TONE[item.kind] ?? "var(--muted)" }} />
                  <span className="muted" style={{ whiteSpace: "nowrap", minWidth: 95 }}>
                    {new Date(item.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{t(item.title_key)}</span>
                    {item.detail && <span className="muted"> · {item.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Statut NHS S2 */}
      <div className="card" style={{ padding: 18 }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
          {t("Statut NHS S2")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["envoye-nhs", "in_review", "additional_info", "accepted", "refused"].map((s) => {
            const isActive = patient.nhs_status === s || (s === "envoye-nhs" && patient.status === "envoye-nhs");
            const label = s === "envoye-nhs" ? t("Envoyé NHS") : t(NHS_BADGE_LABEL[s] ?? s);
            return (
              <span
                key={s}
                style={{
                  padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: 999,
                  border: `1px solid ${isActive ? "var(--info)" : "var(--border)"}`,
                  color: isActive ? "var(--info)" : "var(--muted)",
                  background: isActive ? "color-mix(in srgb, var(--info) 12%, transparent)" : "transparent",
                }}
              >
                {label}
              </span>
            );
          })}
        </div>
        {patient.status !== "envoye-nhs" && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            {t("Dossier pas encore soumis à la NHS.")}
          </p>
        )}
      </div>

      {/* Actions rapides — mêmes boutons que le legacy (relances/soumission
          non câblées côté n8n, comme sur l'ancien dashboard). */}
      <div className="card" style={{ padding: 18 }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
          {t("Actions rapides")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="ghost" disabled title={t("Non câblé — identique à l'ancien dashboard (workflow n8n à brancher)")} style={{ padding: "6px 12px", fontSize: 12, opacity: 0.6 }}>
            ✉ {t("Relancer par email")}
          </button>
          <button type="button" className="ghost" disabled title={t("Non câblé — identique à l'ancien dashboard (workflow n8n à brancher)")} style={{ padding: "6px 12px", fontSize: 12, opacity: 0.6 }}>
            ◐ {t("Relancer WhatsApp")}
          </button>
          <button type="button" disabled={!docComplete} title={docComplete ? t("Non câblé — identique à l'ancien dashboard (workflow n8n à brancher)") : t("Dossier incomplet")} style={{ padding: "6px 12px", fontSize: 12, opacity: docComplete ? 1 : 0.5 }}>
            ↗ {t("Soumettre à la NHS")}
          </button>
        </div>
      </div>

      {/* Escalade — fonctionnel : écrit dans dashboard_assignments (files
          Summer / Rain partagées avec l'ancien dashboard). */}
      {patient.escalade && (
        <div className="card" style={{ padding: 18, borderColor: "var(--bad)", background: "color-mix(in srgb, var(--bad) 8%, var(--panel))" }}>
          <div style={{ fontWeight: 600, color: "var(--bad)" }}>{t("Escalade requise — Aucune réponse depuis 3 jours+")}</div>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 12px" }}>
            {t("Assigner ce patient à un coordinateur pour un suivi humain.")}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => assign("Rain")} disabled={assigning !== null} style={{ padding: "6px 12px", fontSize: 12, background: "var(--warn)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer" }}>
              👤 {assigning === "Rain" ? t("Assignation…") : t("Assigner à Rain")}
            </button>
            <button type="button" onClick={() => assign("Summer")} disabled={assigning !== null} style={{ padding: "6px 12px", fontSize: 12, background: "var(--warn)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer" }}>
              👤 {assigning === "Summer" ? t("Assignation…") : t("Assigner à Summer")}
            </button>
            <button type="button" className="ghost" onClick={() => assign(null)} disabled={assigning !== null} style={{ padding: "6px 12px", fontSize: 12, color: "var(--bad)", borderColor: "var(--bad)", borderRadius: 8 }}>
              ✕ {assigning === "__unassign__" ? t("Désassignation…") : t("Désassigner")}
            </button>
            {assignedMsg && <span style={{ fontSize: 12, color: "var(--good)" }}>{assignedMsg}</span>}
          </div>
        </div>
      )}

      {/* Full CRM profile — loaded via Axon contact_id resolved from phone */}
      {contactId && <PatientFullProfile contactId={contactId} />}
    </div>
  );
}

// ── Full CRM profile (read-only) ─────────────────────────────────────────────
// Mirrors the PatientDrawer used in Supervision — fetches all leads_rdv columns
// and contact-calls and renders them grouped by section. Shown at the bottom of
// every patient detail page so coordinators have the complete picture.

const FP_SECTIONS: Array<{ title: string; cols: string[] }> = [
  { title: "Identité",       cols: ["nom", "email", "patient_dob", "numero_telephone"] },
  { title: "Suivi",          cols: ["qualification", "current_phase", "cycle_status", "rappel_rdv", "next_call_at", "do_not_call", "voicemail_detected", "call_count", "last_call_datetime", "last_qualification_update"] },
  { title: "Clinique",       cols: ["bmi", "poids", "taille", "allergies", "anesthesia_allergies", "current_medications", "past_surgeries", "other_chronic_conditions"] },
  { title: "NHS / Documents", cols: ["nhs_wmp_status", "nhs_wmp_details", "document_status", "received_documents", "missing_documents"] },
  { title: "Cadence",        cols: ["date_j1", "date_j3", "date_j5", "j1_attempts", "j3_attempts", "j5_attempts"] },
  { title: "Notes & Source", cols: ["note", "call_1_note", "call_2_note", "call_3_note", "raison_ne_pas_rappeler", "source_lead", "form_facebook"] },
];
const FP_LONG_KEYS = new Set(["note", "call_1_note", "call_2_note", "call_3_note", "raison_ne_pas_rappeler", "nhs_wmp_details", "received_documents", "missing_documents", "other_chronic_conditions", "past_surgeries", "current_medications", "allergies", "anesthesia_allergies"]);

interface FpCol { key: string; label: string; type: string; }
interface FpCall { id: string; started_at: string; duration_secs: number | null; direction: string | null; qualification: string | null; summary: string | null; }

function PatientFullProfile({ contactId }: { contactId: string }) {
  const t = useT();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [cols, setCols] = useState<FpCol[]>([]);
  const [calls, setCalls] = useState<FpCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/desk/patient-row/${encodeURIComponent(contactId)}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/desk/contact-calls/${encodeURIComponent(contactId)}?limit=10`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([rowJ, callsJ]) => {
        if (!alive) return;
        setRow((rowJ as { row?: Record<string, unknown> }).row ?? null);
        setCols((rowJ as { columns?: FpCol[] }).columns ?? []);
        setCalls(((callsJ as { calls?: FpCall[] }).calls) ?? []);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [contactId]);

  if (loading) return <div className="card" style={{ padding: "12px 16px" }}><p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("Chargement…")}</p></div>;
  if (!row) return null;

  const byKey = new Map(cols.map((c) => [c.key, c]));
  const usedKeys = new Set(FP_SECTIONS.flatMap((s) => s.cols));
  const otherCols = cols.filter((c) => !usedKeys.has(c.key) && c.key !== "id" && c.key !== "created_at" && row[c.key] != null && row[c.key] !== "");

  function renderVal(c: FpCol) {
    const raw = row![c.key];
    if (raw == null || raw === "") return <span className="muted">—</span>;
    if (c.key === "do_not_call" || c.key === "voicemail_detected") {
      const on = raw === true || raw === "true" || raw === 1;
      return <span style={{ color: on ? "var(--warn)" : "var(--muted)", fontWeight: 600 }}>{on ? "✓ Oui" : "Non"}</span>;
    }
    const str = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    if ((c.key.includes("date") || c.key.includes("_at") || c.key.includes("datetime")) && /^\d{4}-\d{2}-\d{2}/.test(str)) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return <span>{d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>;
    }
    if (FP_LONG_KEYS.has(c.key)) return <span style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{str}</span>;
    return <span style={{ fontWeight: 500 }}>{str}</span>;
  }

  return (
    <>
      {FP_SECTIONS.map((sec) => {
        const secCols = sec.cols.map((k) => byKey.get(k)).filter((c): c is FpCol => !!c && row[c.key] != null && row[c.key] !== "");
        if (secCols.length === 0) return null;
        return (
          <div key={sec.title} className="card" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>{t(sec.title)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {secCols.map((c) => (
                <div key={c.key} style={FP_LONG_KEYS.has(c.key) ? { gridColumn: "1 / -1" } : undefined}>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>{c.label}</div>
                  <div style={{ fontSize: 13 }}>{renderVal(c)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {otherCols.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>{t("Autres champs")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {otherCols.map((c) => (
              <div key={c.key}>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>{c.label}</div>
                <div style={{ fontSize: 13 }}>{renderVal(c)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {calls.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{t("Derniers appels")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {calls.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, padding: 8, fontSize: 12, border: "1px solid var(--border)", borderRadius: 6 }}>
                <div>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>{new Date(c.started_at).toLocaleString("fr-FR")}</div>
                  {c.summary && <div className="muted" style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.summary}</div>}
                </div>
                <div className="muted">{c.direction === "in" ? "↘" : "↗"} {c.duration_secs ?? 0}s</div>
                {c.qualification && <span className="tag" style={{ fontSize: 10 }}>{c.qualification}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Contact detail view ───────────────────────────────────────────────────────
// For patients found via the Axon CRM contact search who are not in the NHS
// programme (email_sent/whatsapp_sent). Shows their full CRM profile from
// leads_rdv / calls via the Supervision desk endpoints.
function ContactDetailView({
  contactId,
  displayName,
  onBackDashboard,
}: {
  contactId: string;
  displayName: string;
  onBackDashboard: () => void;
}) {
  const t = useT();
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Breadcrumb
        items={[
          { label: t("Vue d'ensemble"), onClick: onBackDashboard },
          { label: displayName },
        ]}
      />
      <div className="card" style={{ padding: 18, display: "flex", alignItems: "flex-start", gap: 14 }}>
        <Avatar initials={initialsOfName(displayName)} size={52} />
        <div>
          <h3 style={{ margin: 0, fontSize: 20 }}>{displayName}</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("Fiche patient CRM")}</div>
        </div>
      </div>
      <PatientFullProfile contactId={contactId} />
    </div>
  );
}
