import Link from "next/link";
import { CAMPAIGN_TEMPLATES, ADVANCED_CARD } from "@/lib/campaign-templates";

export const dynamic = "force-dynamic";

// Step 1 of campaign creation: pick a use case (or "advanced" to skip
// templates entirely). Each card links to the wizard with ?template=<id>; the
// wizard pre-fills concurrency / attempts / hours / AMD from that template.
// Generic — no tenant-specific logic.

const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

export default function NewCampaignPickerPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nouvelle campagne</h1>
          <div className="subtitle">
            Choisis un modèle adapté à ton usage — il pré-remplit cadence,
            créneaux, tentatives et règles. Tu pourras tout ajuster ensuite.
          </div>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}
      >
        {CAMPAIGN_TEMPLATES.map((t) => (
          <Link
            key={t.id}
            href={`/campaigns/new/wizard?template=${t.id}`}
            className="card"
            style={{ textDecoration: "none", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 26 }}>{t.emoji}</span>
              <strong style={{ color: "var(--text)" }}>{t.title}</strong>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{t.subtitle}</div>

            <div style={{ display: "grid", gap: 4, marginTop: 4, fontSize: 11 }}>
              <Row label="Cadence">
                {t.defaults.maxConcurrency} simultanés · {t.defaults.maxAttempts} tentative{t.defaults.maxAttempts > 1 ? "s" : ""}
              </Row>
              <Row label="Horaires">
                {t.defaults.hourStart}–{t.defaults.hourEnd}
              </Row>
              <Row label="Jours">
                <span style={{ display: "inline-flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const on = t.defaults.days.includes(d);
                    return (
                      <span
                        key={d}
                        style={{
                          width: 16, height: 16, borderRadius: 3,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9, fontWeight: 700,
                          background: on ? "var(--accent)" : "var(--bg-2)",
                          color: on ? "#fff" : "var(--muted)",
                        }}
                      >
                        {DAY_LABELS[d]}
                      </span>
                    );
                  })}
                </span>
              </Row>
            </div>
          </Link>
        ))}

        <Link
          href="/campaigns/new/wizard"
          className="card"
          style={{
            textDecoration: "none",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderStyle: "dashed",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>{ADVANCED_CARD.emoji}</span>
            <strong style={{ color: "var(--text)" }}>{ADVANCED_CARD.title}</strong>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{ADVANCED_CARD.subtitle}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Pour les cas qui ne rentrent dans aucun modèle ci-dessus.
          </div>
        </Link>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="muted" style={{ minWidth: 60 }}>{label}</span>
      <span style={{ color: "var(--text)" }}>{children}</span>
    </div>
  );
}
