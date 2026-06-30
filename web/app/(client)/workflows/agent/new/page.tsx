import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import {
  AgentWorkflowForm,
  type MgmtAgentOption,
  type WfDataTable,
  type WfCredential,
} from "@/components/workflows/AgentWorkflowForm";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default async function NewAgentWorkflowPage() {
  let agents: MgmtAgentOption[] = [];
  let dataTables: WfDataTable[] = [];
  let credentials: WfCredential[] = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();

      const { data: ags } = await sb
        .from("agents")
        .select("id, name")
        .eq("org_id", orgId)
        .eq("purpose", "management")
        .order("updated_at", { ascending: false });
      agents = (ags ?? []) as MgmtAgentOption[];

      const { data: dts } = await sb
        .from("tenant_data_tables")
        .select("id, label, physical_table, phone_column, columns")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      dataTables = (dts ?? []).map((t) => ({
        id: t.id as string,
        label: t.label as string,
        physical_table: t.physical_table as string,
        phone_column: (t.phone_column as string) ?? "",
        columns: Array.isArray(t.columns) ? (t.columns as WfDataTable["columns"]) : [],
      }));

      // Credentials: never expose secrets — only id/name/kind for the picker.
      const { data: creds } = await sb
        .from("org_credentials")
        .select("id, name, kind")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true });
      credentials = (creds ?? []) as WfCredential[];
    } catch {
      /* ignore — the form degrades gracefully */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nouveau workflow IA</h1>
          <div className="subtitle">
            Branche un agent de gestion à une table et un canal. Il rédige et agit pour chaque fiche.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/workflows"><button className="ghost">← Workflows</button></Link>
          <HelpButton contextKey="workflows" />
        </div>
      </div>
      <AgentWorkflowForm agents={agents} dataTables={dataTables} credentials={credentials} />
    </>
  );
}
