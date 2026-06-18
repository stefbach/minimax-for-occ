import Link from "next/link";
import { listN8nWorkflows } from "@/lib/n8n";
import { HelpButton } from "@/components/help/HelpButton";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { OrgWebhooksPanel, type WebhookRow, type DataTableOption } from "@/components/workflows/OrgWebhooksPanel";
import { NativeAutomationsPanel } from "@/components/workflows/NativeAutomationsPanel";

export const dynamic = "force-dynamic";

/**
 * /workflows — home of the NATIVE Axon automations (mini-n8n). The legacy
 * n8n flow catalogue lives on the /workflows/n8n sub-page, reachable via
 * the "Voir les flows n8n" button.
 */
export default async function WorkflowsPage() {
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

  // Count only — the list itself lives on /workflows/n8n.
  let n8nCount = 0;
  try {
    n8nCount = orgTag ? (await listN8nWorkflows({ tags: orgTag })).length : 0;
  } catch {
    /* n8n unreachable — the sub-page surfaces the error */
  }

  if (hasSupabase() && orgId) {
    try {
      const sb = supabaseServer();
      const { data: wh } = await sb
        .from("org_webhooks")
        .select("id,name,url,event,data_table_id,watch_column,match_values,active")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true });
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Automatisation</h1>
          <div className="subtitle">
            Workflows natifs Axon : déclencheur cron, filtres, actions (email,
            WhatsApp, mise à jour), credentials gérés côté serveur.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/workflows/approvals"><button className="ghost">À valider</button></Link>
          <Link href="/workflows/connections"><button className="ghost">⚙️ Connexions</button></Link>
          <Link href="/workflows/n8n">
            <button className="ghost">Flows n8n ({n8nCount}) →</button>
          </Link>
          <Link href="/workflows/agent/new"><button>+ Workflow IA</button></Link>
          <Link href="/workflows/new"><button className="ghost">Workflow n8n</button></Link>
          <HelpButton contextKey="workflows" />
        </div>
      </div>

      <NativeAutomationsPanel />

      <OrgWebhooksPanel initial={webhooks} dataTables={dataTables} />
    </>
  );
}
