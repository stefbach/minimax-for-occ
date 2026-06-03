import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { HelpButton } from "@/components/help/HelpButton";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { ContactListsClient } from "@/components/contacts/ContactListsClient";

export const dynamic = "force-dynamic";

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  columns: unknown;
  contact_count: number;
  updated_at: string;
}

export default async function ContactsHub() {
  let lists: ListRow[] = [];
  let unsortedCount = 0;

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();

      // 1. All bases owned by the caller's org.
      const { data: rows } = await sb
        .from("contact_lists")
        .select("id, name, description, columns, updated_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      const baseRows = (rows ?? []) as Omit<ListRow, "contact_count">[];

      // 2. Contact counts per list (single round-trip).
      const counts: Record<string, number> = {};
      if (baseRows.length > 0) {
        const ids = baseRows.map((r) => r.id);
        const { data: cs } = await sb
          .from("contacts")
          .select("list_id")
          .eq("org_id", orgId)
          .in("list_id", ids);
        for (const c of cs ?? []) {
          const k = (c as { list_id: string }).list_id;
          counts[k] = (counts[k] ?? 0) + 1;
        }
      }
      lists = baseRows.map((r) => ({ ...r, contact_count: counts[r.id] ?? 0 }));

      // 3. Count contacts that aren't attached to any list yet (legacy
      //    contacts created before bases existed). We expose them via a
      //    synthetic "Tous les contacts" link.
      const { count } = await sb
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .is("list_id", null);
      unsortedCount = count ?? 0;
    } catch {
      // Table missing on first deploy: render empty state.
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Bases de contacts</h1>
          <div className="subtitle">
            {lists.length} base{lists.length === 1 ? "" : "s"}
            {unsortedCount > 0 && ` · ${unsortedCount} contact${unsortedCount === 1 ? "" : "s"} non classé${unsortedCount === 1 ? "" : "s"}`}
          </div>
        </div>
        <HelpButton contextKey="contacts" />
      </div>

      <ContactListsClient initialLists={lists} unsortedCount={unsortedCount} />
    </>
  );
}
