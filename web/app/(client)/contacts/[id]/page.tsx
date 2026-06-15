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

  // Pick an existing timestamp column to order by — different per-tenant
  // tables use different names (created_at on Axon-default schemas,
  // date_creation on OCC-aligned tables, etc.). Fall back to no order at
  // all rather than erroring out.
  //
  // Wati 2026-06-15: load only the first page (20 rows) on the server so
  // the initial paint stays snappy on tables with thousands of rows. The
  // client then fetches subsequent pages via /api/data-tables/.../rows.
  // `total` is requested via the `count: "exact"` head so the pager can
  // render "X / Y" without a second roundtrip.
  const INITIAL_PER_PAGE = 20;
  let rows: Record<string, unknown>[] = [];
  let total = 0;
  try {
    const { data: colInfo } = await sb
      .from("information_schema.columns" as never)
      .select("column_name")
      .eq("table_name", reg.physical_table);
    const colNames = new Set(
      (colInfo ?? []).map((c) => (c as { column_name: string }).column_name),
    );
    const orderCol = ["created_at", "date_creation", "inserted_at", "updated_at"].find(
      (c) => colNames.has(c),
    );

    let q = sb
      .from(reg.physical_table)
      .select("*", { count: "exact" })
      .range(0, INITIAL_PER_PAGE - 1);
    if (orderCol) q = q.order(orderCol, { ascending: false, nullsFirst: false });
    const { data, count } = await q;
    rows = data ?? [];
    total = count ?? rows.length;
  } catch {
    rows = [];
    total = 0;
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
            {total} contact{total === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <DataTableDetail
        registryId={reg.id}
        physicalTable={reg.physical_table}
        columns={columns}
        phoneColumn={reg.phone_column}
        nameColumn={reg.name_column ?? null}
        initialRows={rows}
        initialTotal={total}
        initialPerPage={INITIAL_PER_PAGE}
      />
    </>
  );
}
