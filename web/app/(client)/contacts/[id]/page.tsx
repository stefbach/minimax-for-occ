import Link from "next/link";
import { notFound } from "next/navigation";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { ContactListDetail } from "@/components/contacts/ContactListDetail";

export const dynamic = "force-dynamic";

interface ColumnSpec {
  key: string;
  label: string;
  type: string;
}

export default async function ContactListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return (
      <div className="card">
        <h3>Supabase non configuré</h3>
      </div>
    );
  }

  const sb = supabaseServer();
  const orgId = await currentOrgIdForServer();

  const { data: list } = await sb
    .from("contact_lists")
    .select("id, name, description, columns")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!list) return notFound();

  const { data: rows } = await sb
    .from("contacts")
    .select("id, display_name, e164, email, attributes, created_at, updated_at")
    .eq("org_id", orgId)
    .eq("list_id", id)
    .order("updated_at", { ascending: false })
    .limit(1000);

  const columns = (Array.isArray(list.columns) ? list.columns : []) as ColumnSpec[];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{list.name}</h1>
          <div className="subtitle">
            <Link href="/contacts" style={{ color: "var(--muted)" }}>
              ← Bases de contacts
            </Link>
            {" · "}
            {(rows ?? []).length} contact{(rows ?? []).length === 1 ? "" : "s"}
            {" · "}
            {columns.length} colonne{columns.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      {list.description && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>{list.description}</p>
      )}

      <ContactListDetail
        listId={list.id}
        listName={list.name}
        columns={columns}
        initialContacts={rows ?? []}
      />
    </>
  );
}
