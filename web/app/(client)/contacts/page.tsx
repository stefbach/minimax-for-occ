import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { HelpButton } from "@/components/help/HelpButton";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { DataTablesClient, type DataTableRow } from "@/components/contacts/DataTablesClient";

export const dynamic = "force-dynamic";

export default async function ContactsHub() {
  let tables: DataTableRow[] = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();
      const { data } = await sb
        .from("tenant_data_tables")
        .select("id, physical_table, label, columns, phone_column, name_column, is_managed, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as Omit<DataTableRow, "row_count">[];

      // Row count per physical table (best-effort).
      const withCounts: DataTableRow[] = [];
      for (const t of rows) {
        let count = 0;
        try {
          const { count: c } = await sb
            .from(t.physical_table)
            .select("id", { count: "exact", head: true });
          count = c ?? 0;
        } catch {
          count = 0;
        }
        withCounts.push({ ...t, row_count: count });
      }
      tables = withCounts;
    } catch {
      // registry table missing on first deploy — render empty state
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CRM / Contact tables</h1>
          <div className="subtitle">
            {tables.length} data table{tables.length === 1 ? "" : "s"}
          </div>
        </div>
        <HelpButton contextKey="contacts" />
      </div>

      <DataTablesClient initialTables={tables} />
    </>
  );
}
