import Link from "next/link";
import { listN8nWorkflows } from "@/lib/n8n";
import { HelpButton } from "@/components/help/HelpButton";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { OrgWebhooksPanel, type WebhookRow, type DataTableOption } from "@/components/workflows/OrgWebhooksPanel";
import { NativeAutomationsPanel } from "@/components/workflows/NativeAutomationsPanel";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  // Resolve this client's n8n tag first — the Workflows list is filtered by it
  // so a tenant only ever sees its own flows on the shared n8n instance.
  let orgTag: string | null = null;
  let webhooks: WebhookRow[] = [];
  let dataTables: DataTableOption[] = [];
  let orgId: string | null = null;
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      orgId = await currentOrgIdForServer();
      const { data: org } = await sb
        .from("organizations")
        .select("n8n_tag,slug")
        .eq("id", orgId)
        .maybeSingle();
      orgTag = ((org?.n8n_tag as string | null) || (org?.slug as string | null)) ?? null;
    } catch {
      /* ignore */
    }
  }

  let workflows: Awaited<ReturnType<typeof listN8nWorkflows>> = [];
  let error: string | null = null;
  try {
    // Only this org's tagged workflows. Without a tag we show nothing rather
    // than leaking every tenant's flows.
    workflows = orgTag ? await listN8nWorkflows({ tags: orgTag }) : [];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Outbound webhook triggers (post-RDV automations) + the org's data tables
  // (for scoping the dropdown). Loaded best-effort.
  if (hasSupabase() && orgId) {
    try {
      const sb = supabaseServer();
      const { data: wh } = await sb
        .from("org_webhooks")
        .select("id,name,url,event,data_table_id,watch_column,match_values,active")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      webhooks = (wh ?? []) as WebhookRow[];
      const { data: dt } = await sb
        .from("tenant_data_tables")
        .select("id,label")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      dataTables = (dt ?? []) as DataTableOption[];
    } catch {
      /* ignore */
    }
  }

  const editorBase = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const active = workflows.filter((w) => w.active);
  const inactive = workflows.filter((w) => !w.active);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Workflows n8n</h1>
          <div className="subtitle">
            {workflows.length} workflow{workflows.length === 1 ? "" : "s"}
            {orgTag ? <> · filtré sur le tag <span className="kbd">{orgTag}</span></> : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/workflows/new"><button>+ Nouveau workflow</button></Link>
          <HelpButton contextKey="workflows" />
        </div>
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

      <NativeAutomationsPanel />

      <OrgWebhooksPanel initial={webhooks} dataTables={dataTables} />

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
