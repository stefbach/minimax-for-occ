import Link from "next/link";
import { notFound } from "next/navigation";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { DataTableDetail, type ColumnSpec } from "@/components/contacts/DataTableDetail";

export const dynamic = "force-dynamic";

export default async function DataTablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return <div className="card"><h3>Supabase non configuré</h3></div>;
  }
  const sb = supabaseServer();
  const orgId = await currentOrgIdForServer();

  const { data: reg } = await sb
    .from("tenant_data_tables")
    .select("id, physical_table, label, columns, phone_column, name_column, is_managed")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!reg) return notFound();

  let rows: Record<string, unknown>[] = [];
  try {
    const { data } = await sb
      .from(reg.physical_table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    rows = data ?? [];
  } catch {
    rows = [];
  }

  const columns = (Array.isArray(reg.columns) ? reg.columns : []) as ColumnSpec[];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{reg.label}</h1>
          <div className="subtitle">
            <Link href="/contacts" style={{ color: "var(--muted)" }}>← Tables de contacts</Link>
            {" · "}
            <span style={{ fontFamily: "monospace" }}>{reg.physical_table}</span>
            {" · "}
            {rows.length} contact{rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <DataTableDetail
        registryId={reg.id}
        physicalTable={reg.physical_table}
        columns={columns}
        phoneColumn={reg.phone_column}
        initialRows={rows}
      />
    </>
  );
}
