import Link from "next/link";
import { listN8nWorkflows } from "@/lib/n8n";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  let workflows: Awaited<ReturnType<typeof listN8nWorkflows>> = [];
  let error: string | null = null;
  try {
    workflows = await listN8nWorkflows();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const editorBase = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const active = workflows.filter((w) => w.active);
  const inactive = workflows.filter((w) => !w.active);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Workflows n8n</h1>
          <div className="subtitle">{workflows.length} workflow{workflows.length === 1 ? "" : "s"} sur l&apos;instance.</div>
        </div>
        <Link href="/workflows/new"><button>+ Nouveau workflow</button></Link>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
          {error}
          <div className="muted" style={{ marginTop: 6 }}>
            Vérifiez que <span className="kbd">N8N_BASE_URL</span> et{" "}
            <span className="kbd">N8N_API_KEY</span> sont définis sur Vercel.
          </div>
        </div>
      )}

      {!error && (
        <>
          <Section title="Actifs" rows={active} editorBase={editorBase} />
          <Section title="Inactifs" rows={inactive} editorBase={editorBase} dim />
        </>
      )}
    </>
  );
}

function Section({
  title,
  rows,
  editorBase,
  dim,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listN8nWorkflows>>;
  editorBase: string;
  dim?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 16, color: dim ? "var(--muted)" : "var(--text)" }}>{title} · {rows.length}</h2>
      <div className="card" style={{ padding: 0, overflow: "hidden", opacity: dim ? 0.6 : 1 }}>
        <table className="list">
          <thead>
            <tr><th>Nom</th><th>Webhooks</th><th>Tags</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td style={{ fontWeight: 600 }}>{w.name}</td>
                <td>
                  {w.webhook_paths.length === 0
                    ? <span className="muted" style={{ fontSize: 12 }}>—</span>
                    : w.webhook_paths.map((p) => (
                        <span key={p} className="kbd" style={{ marginRight: 6 }}>/{p}</span>
                      ))}
                </td>
                <td>
                  {w.tags.length === 0
                    ? <span className="muted" style={{ fontSize: 12 }}>—</span>
                    : w.tags.map((t) => <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>)}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Link
                    href={`/workflows/${w.id}`}
                    style={{ marginRight: 6 }}
                  >
                    <button className="ghost" style={{ padding: "5px 9px" }}>Éditer (intégré)</button>
                  </Link>
                  {editorBase && (
                    <a href={`${editorBase}/workflow/${w.id}`} target="_blank" rel="noopener noreferrer">
                      <button className="subtle" style={{ padding: "5px 9px" }}>Ouvrir n8n ↗</button>
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
