"use client";

import { useEffect, useState } from "react";
import type { NhsSuiviResponse } from "@/app/api/dashboard/nhs-suivi/route";
import { useT } from "@/lib/i18n";

// Clones the OCC demo's "Suivi patient NHS S2" panel in Axon's theme.
// Visible only for orgs where the feature flag is on (see DashboardClient).

export function NhsSuiviTab() {
  const t = useT();
  const [data, setData] = useState<NhsSuiviResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Bloqué 5j+" card expands inline into the stalled-patient list.
  const [showStalled, setShowStalled] = useState(false);

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
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>
              {data.submitted_this_month} <span style={{ fontSize: 22, opacity: 0.7 }}>/ {data.monthly_objective}</span>
            </div>
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
        ctaHref="/contacts?filter=stale_3d"
        value={data.pending_response_3d_plus}
      />

      {/* Prêts à soumettre */}
      <AlertRow
        tone="good"
        icon="✓"
        title={t("Prêts à soumettre")}
        subtitle={t("Dossiers complets — soumission NHS possible")}
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
          />
          <CommCard
            label={t("Email relance J+2")}
            value={data.comms.email_j2_sent}
            hint={t("Relance avec liste des 11 docs")}
            tone="var(--warn)"
            icon="✉"
          />
          <CommCard
            label={t("WhatsApp relance J+2")}
            value={data.comms.whatsapp_sent}
            hint={t("Relance en parallèle de l'email")}
            tone="var(--good)"
            icon="◐"
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
          />
          <CommCard
            label={t("Documents partiels")}
            value={data.file_status.partial}
            hint={t("Au moins un document manquant")}
            tone="var(--warn)"
            icon="◐"
          />
          <CommCard
            label={t("Dossiers complets")}
            value={data.file_status.complete}
            hint={t("BMI, DOB, allergies, traitements, antécédents")}
            tone="var(--good)"
            icon="●"
          />
          <CommCard
            label={t("Sans réponse 3j+")}
            value={data.file_status.no_response_3d}
            hint={t("Escalade nécessaire")}
            tone="var(--bad)"
            icon="⚠"
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
          />
          <CommCard
            label={t("In review NHS")}
            value={data.nhs_tracking.in_review}
            hint={t("Instruction en cours")}
            tone="var(--warn)"
            icon="⌛"
          />
          <CommCard
            label={t("Acceptés NHS")}
            value={data.nhs_tracking.accepted}
            hint={t("Dossiers approuvés")}
            tone="var(--good)"
            icon="✓"
          />
          <CommCard
            label={t("Refusés NHS")}
            value={data.nhs_tracking.rejected}
            hint={t("Dossiers refusés")}
            tone="var(--bad)"
            icon="✕"
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
  label, value, hint, tone, icon,
}: {
  label: string;
  value: number;
  hint: string;
  tone: string;
  icon: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
        <span style={{ fontSize: 14, color: tone }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: tone }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
    </div>
  );
}
