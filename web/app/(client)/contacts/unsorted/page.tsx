import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { ContactsClient } from "@/components/contacts/ContactsClient";

export const dynamic = "force-dynamic";

/**
 * "Tous les contacts non classés" — legacy view that shows every contact
 * whose list_id is NULL. Kept so users don't lose access to contacts
 * created before the Bases de Contacts feature shipped.
 */
export default async function UnsortedContactsPage() {
  let initial: any[] = [];
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();
      const { data } = await sb
        .from("contacts")
        .select("*")
        .eq("org_id", orgId)
        .is("list_id", null)
        .order("updated_at", { ascending: false })
        .limit(500);
      initial = data ?? [];
    } catch {
      /* table missing on first deploy — show empty list */
    }
  }
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Contacts non classés</h1>
          <div className="subtitle">
            <Link href="/contacts" style={{ color: "var(--muted)" }}>
              ← Bases de contacts
            </Link>
            {" · "}
            {initial.length} contact{initial.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <ContactsClient initial={initial} />
    </>
  );
}
