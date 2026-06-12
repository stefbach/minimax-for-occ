"use client";

import { useEffect, useState } from "react";
import type { NhsSuiviResponse } from "@/app/api/dashboard/nhs-suivi/route";
import type { NhsDrillResponse } from "@/app/api/dashboard/nhs-suivi/drill/route";
import { useT } from "@/lib/i18n";

// Clones the OCC demo's "Suivi patient NHS S2" panel in Axon's theme.
// Visible only for orgs where the feature flag is on (see DashboardClient).

// Queue dot colors — same trio as the legacy dashboard's coordinator cards.
const COORDINATOR_TONES: Record<string, string> = {
  Summer: "#f59e0b",
  Rain: "#3b82f6",
  Stormi: "#8b5cf6",
};

export function NhsSuiviTab() {
  const t = useT();
  const [data, setData] = useState<NhsSuiviResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Bloqué 5j+" card expands inline into the stalled-patient list.
  const [showStalled, setShowStalled] = useState(false);
  // Drill-down: every card opens the list of patients it counted, so the
  // operator can verify each figure (parité legacy).
  const [drill, setDrill] = useState<{ metric: string; title: string } | null>(null);
  const openDrill = (metric: string, title: string) => setDrill({ metric, title });

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
      <div className="page-header" style={{ margin: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t("Suivi patient NHS S2")}</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            {t("Pipeline complet · De l'appel initial à la soumission NHS S2")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>{clock}</span>
          <button onClick={fetchData} className="ghost" style={{ padding: "5px 12px", fontSize: 13 }}>↻ {t("Actualiser")}</button>
        </div>
      </div>

      {/* Objectif mensuel — bandeau bleu */}
      <div
        className="card"
        style={{
          padding: 20,
          background: "linear-gradient(135deg, color-mix(in srgb, var(--info) 90%, #1d4ed8) 0%, #1d4ed8 100%)",
          color: "#fff",
          borderColor: "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.85 }}>
              {t("Objectif mensuel NHS S2")}
            </div>
            <button
              type="button"
              onClick={() => openDrill("submitted_month", t("Objectif mensuel NHS S2"))}
              title={t("Voir les dossiers soumis ce mois")}
              style={{
                fontSize: 36, fontWeight: 700, lineHeight: 1.1, marginTop: 4,
                background: "none", border: "none", color: "inherit", padding: 0,
                cursor: "pointer", font: "inherit", display: "block", textAlign: "left",
              }}
            >
              {data.submitted_this_month} <span style={{ fontSize: 22, opacity: 0.7 }}>/ {data.monthly_objective}</span>
            </button>
            <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
              {t("dossiers soumis ce mois")} · {remaining} {t("restants à atteindre")}
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 180 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.85 }}>{t("Progression")}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{pct}%</div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.25)", borderRadius: 6, overflow: "hidden", marginTop: 6 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "#fff" }} />
            </div>
            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>
              {daysLeftInMonth} {t("jours restants dans le mois")}
            </div>
          </div>
        </div>
      </div>

      {/* Escalade requise */}
      <AlertRow
        tone="bad"
        icon="⚠"
        title={t("Escalade requise")}
        subtitle={t("Patients sans réponse depuis 3 jours+")}
        ctaLabel={t("Voir et assigner")}
        onCta={() => openDrill("pending_3d", t("Escalade requise"))}
        value={data.pending_response_3d_plus}
      />

      {/* Prêts à soumettre */}
      <AlertRow
        tone="good"
        icon="✓"
        title={t("Prêts à soumettre")}
        subtitle={t("Dossiers complets — soumission NHS possible")}
        ctaLabel={t("Voir les patients")}
        onCta={() => openDrill("ready", t("Prêts à soumettre"))}
        value={data.ready_to_submit}
      />

      {/* Bloqués — dossiers partiels sans activité 5j+ (parité legacy) */}
      <div style={{ display: "grid", gap: 8 }}>
        <AlertRow
          tone="warn"
          icon="⏳"
          title={t("Bloqué — aucun changement depuis 5j+")}
          subtitle={
            data.stalled.count === 0
              ? t("Aucun dossier partiel bloqué")
              : t("Dossiers partiels sans activité depuis 5 jours ou plus")
          }
          value={data.stalled.count}
          ctaLabel={data.stalled.count > 0 ? (showStalled ? t("Masquer la liste") : t("Voir les patients")) : undefined}
          onCta={data.stalled.count > 0 ? () => setShowStalled((v) => !v) : undefined}
        />
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
      </div>

      {/* Files coordinateurs — mêmes 3 files que le dashboard legacy. */}
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
                        key={`${p.phone ?? i}`}
                        title={[p.phone, p.reason, p.assigned_at ? new Date(p.assigned_at).toLocaleDateString("fr-FR") : null].filter(Boolean).join(" · ")}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "6px 4px", borderTop: i > 0 ? "1px solid var(--border)" : "none", fontSize: 13,
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name ?? p.phone ?? t("Lead introuvable (supprimé)")}
                        </span>
                        <span className="muted" aria-hidden>›</span>
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

      {/* Suivi NHS S2 (après soumission) */}
      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          🏥 {t("Suivi NHS S2 (après soumission)")}
        </div>
        <div className="grid-kpi">
          <CommCard
            label={t("Envoyés NHS")}
            value={data.nhs_tracking.submitted}
            hint={t("Dossiers transmis au NHS")}
            tone="var(--info)"
            icon="↗"
            onClick={() => openDrill("sent_nhs", t("Envoyés NHS"))}
          />
          <CommCard
            label={t("In review NHS")}
            value={data.nhs_tracking.in_review}
            hint={t("Instruction en cours")}
            tone="var(--warn)"
            icon="⌛"
            onClick={() => openDrill("in_review", t("In review NHS"))}
          />
          <CommCard
            label={t("Acceptés NHS")}
            value={data.nhs_tracking.accepted}
            hint={t("Dossiers approuvés")}
            tone="var(--good)"
            icon="✓"
            onClick={() => openDrill("accepted", t("Acceptés NHS"))}
          />
          <CommCard
            label={t("Refusés NHS")}
            value={data.nhs_tracking.rejected}
            hint={t("Dossiers refusés")}
            tone="var(--bad)"
            icon="✕"
            onClick={() => openDrill("rejected", t("Refusés NHS"))}
          />
        </div>
      </div>

      {/* Pipeline de conversion */}
      <PipelinePanel data={data} />

      {!data.has_data && (
        <div className="card" style={{ borderColor: "var(--warn)", color: "var(--warn)", fontSize: 13 }}>
          ℹ️ {t("Aucune table de leads n'est encore enregistrée pour cette organisation. Les chiffres se rempliront dès le premier appel.")}
        </div>
      )}

      <NhsDrillSheet drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

// Slide-over listing the patients behind a clicked card — every figure on
// this tab is verifiable (parité legacy).
function NhsDrillSheet({ drill, onClose }: { drill: { metric: string; title: string } | null; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<NhsDrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!drill) return;
    let alive = true;
    setLoading(true); setErr(null); setData(null);
    fetch(`/api/dashboard/nhs-suivi/drill?metric=${encodeURIComponent(drill.metric)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) setData(j);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [drill]);

  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drill, onClose]);

  if (!drill) return null;
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={drill.title}
      style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", justifyContent: "flex-end" }}
    >
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div
        className="card"
        style={{
          position: "relative", width: "min(720px, 96vw)", height: "100%", borderRadius: 0,
          display: "flex", flexDirection: "column", padding: 0, overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{drill.title}</div>
            {data && (
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {data.total.toLocaleString("fr-FR")} {t("patient(s) concerné(s)")}
                {data.total > data.rows.length ? ` · ${data.rows.length} ${t("affichés")}` : ""}
              </div>
            )}
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label={t("Fermer")} style={{ padding: "4px 10px", fontSize: 16, lineHeight: 1 }}>
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <p className="muted" style={{ padding: 16 }}>{t("Chargement…")}</p>}
          {err && <p style={{ padding: 16, color: "var(--bad)" }}>{err}</p>}
          {data && data.rows.length === 0 && !loading && (
            <p className="muted" style={{ padding: 16 }}>{t("Aucun patient.")}</p>
          )}
          {data && data.rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Patient")}</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Téléphone")}</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Email</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>{t("Statut")}</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.phone ?? r.email ?? i}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.name ?? "—"}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.phone ?? "—"}</td>
                    <td style={{ padding: "8px 12px", overflowWrap: "anywhere" }}>{r.email ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{r.status ?? "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelinePanel({ data }: { data: NhsSuiviResponse }) {
  const t = useT();
  const total = Math.max(1, data.pipeline.initial_call);
  const steps = [
    {
      key: "initial_call",
      label: t("Appel initial"),
      day: "J0",
      value: data.pipeline.initial_call,
      pct: 100,
    },
    {
      key: "email_reminder",
      label: t("Email relance"),
      day: "J+2",
      value: data.pipeline.email_reminder,
      pct: Math.round((data.pipeline.email_reminder / total) * 100),
    },
    {
      key: "response_received",
      label: t("Réponse reçue"),
      day: "J+2-5",
      value: data.pipeline.response_received,
      pct: Math.round((data.pipeline.response_received / total) * 100),
    },
    {
      key: "file_complete",
      label: t("Dossier complet"),
      day: "J+5-10",
      value: data.pipeline.file_complete,
      pct: Math.round((data.pipeline.file_complete / total) * 100),
    },
    {
      key: "nhs_submitted",
      label: t("Soumis NHS"),
      day: "—",
      value: data.pipeline.nhs_submitted,
      pct: Math.round((data.pipeline.nhs_submitted / total) * 100),
    },
  ];
  // Color stops: var(--info) → var(--good) interpolated by step index.
  const colorFor = (i: number) => {
    const ratio = i / (steps.length - 1);
    return `color-mix(in srgb, var(--good) ${Math.round(ratio * 100)}%, var(--info))`;
  };
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
        ⇆ {t("Pipeline de conversion — étapes patient")}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
            gap: 8,
            alignItems: "stretch",
          }}
        >
          {steps.map((s, i) => {
            const bg = colorFor(i);
            return (
              <div
                key={s.key}
                style={{
                  background: bg,
                  color: "#fff",
                  borderRadius: 8,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: 120,
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {s.day}
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{s.value}</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{s.label}</div>
                </div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>{s.pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
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
