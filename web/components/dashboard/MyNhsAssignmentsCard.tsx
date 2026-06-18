"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { MyQueueResponse, MyQueuePatient } from "@/app/api/dashboard/nhs-suivi/my-queue/route";

// "My NHS assignments" card — shows the logged-in coordinator's patients
// alongside the existing coordinator-queue grid on the NHS S2 dashboard.
// Click a row → opens the existing NhsSuiviTab patient drill via onOpenPatient.
//
// We render nothing when the user isn't a flagged coordinator AND has no
// open assignments, so non-coordinators don't see an empty box.

export function MyNhsAssignmentsCard({ onOpenPatient }: { onOpenPatient: (leadId: string) => void }) {
  const t = useT();
  const [data, setData] = useState<MyQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/dashboard/nhs-suivi/my-queue", { cache: "no-store" });
        if (!cancelled && r.ok) setData((await r.json()) as MyQueueResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !data) return null;
  // Hide when not a coordinator AND nothing's assigned — keeps the dashboard
  // clean for users whose work lives elsewhere (admins, agents on phone work).
  if (!data.user?.is_coordinator && data.patients.length === 0) return null;

  return (
    <div>
      <h3
        style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}
        className="muted"
      >
        👤 {t("Mes patients assignés")}
        {data.user?.full_name ? (
          <span style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, color: "var(--muted)" }}>
            — {data.user.full_name}
          </span>
        ) : null}
      </h3>
      <div className="card" style={{ padding: 14 }}>
        {data.patients.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t("Aucun patient assigné pour le moment.")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            <div
              className="muted"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) 110px 90px 100px 90px",
                gap: 12,
                padding: "6px 8px",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span>{t("Patient")}</span>
              <span>{t("Statut dossier")}</span>
              <span style={{ textAlign: "right" }}>{t("Docs reçus")}</span>
              <span>{t("Assigné")}</span>
              <span style={{ textAlign: "right" }}>{t("Avancement")}</span>
            </div>
            {data.patients.map((p) => (
              <button
                key={p.lead_id}
                type="button"
                onClick={() => onOpenPatient(p.lead_id)}
                title={[p.phone, p.email, p.reason].filter(Boolean).join(" · ")}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 2fr) 110px 90px 100px 90px",
                  gap: 12,
                  padding: "10px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 600 }}>{p.name ?? t("Lead supprimé")}</span>
                  {p.phone ? (
                    <span className="muted" style={{ marginLeft: 8 }}>{p.phone}</span>
                  ) : null}
                </span>
                <span>
                  <DossierBadge status={p.dossier_status} />
                </span>
                <span style={{ textAlign: "right", color: p.documents_received >= 11 ? "var(--ok)" : "var(--warn)", fontWeight: 600 }}>
                  {p.documents_received}/11
                </span>
                <span className="muted">
                  {p.assigned_at
                    ? new Date(p.assigned_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
                    : "—"}
                </span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {p.dossier_completion_pct != null ? `${p.dossier_completion_pct}%` : "—"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DossierBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; color: string }> = {
    NO_DOCUMENTS_RECEIVED: { label: "aucun doc", color: "var(--muted)" },
    MISSING_DOCUMENTS: { label: "incomplet", color: "var(--warn)" },
    READY_TO_SUBMIT: { label: "complet", color: "var(--ok)" },
    SUBMITTED: { label: "envoyé NHS", color: "var(--accent)" },
  };
  const m = (status && map[status]) || { label: status ?? "—", color: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${m.color}`,
        color: m.color,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "lowercase",
      }}
    >
      {m.label}
    </span>
  );
}
