import Link from "next/link";

export function PhaseStub({
  title,
  phase,
  description,
  bullets,
}: {
  title: string;
  phase: string;
  description: string;
  bullets: string[];
}) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <div className="subtitle">
            <span className="tag">{phase}</span>{" "}
            <Link href="/docs/architecture-v2" style={{ color: "var(--muted)" }}>
              voir la roadmap
            </Link>
          </div>
        </div>
      </div>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0 }}>{description}</p>
        <ul style={{ margin: 0, color: "var(--muted)" }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ marginBottom: 4 }}>{b}</li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Le schéma de base (table, RLS multi-tenant) est déjà en place dans Supabase
          (<span className="kbd">supabase/migrations/0006_v2_multitenant.sql</span>,{" "}
          <span className="kbd">0007_v2_flows_campaigns.sql</span>). L&apos;UI sera livrée dans la phase indiquée.
        </p>
      </div>
    </>
  );
}
