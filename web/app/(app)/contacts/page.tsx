import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { ContactsClient } from "@/components/contacts/ContactsClient";

export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

export default async function ContactsPage() {
  let initial: any[] = [];
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const { data } = await sb
        .from("contacts")
        .select("*")
        .eq("org_id", DEFAULT_ORG)
        .order("updated_at", { ascending: false })
        .limit(500);
      initial = data ?? [];
    } catch {
      /* table might not exist yet on this Supabase project — silently start empty */
    }
  }
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <div className="subtitle">{initial.length} contact{initial.length === 1 ? "" : "s"}</div>
        </div>
      </div>
      <ContactsClient initial={initial} />
    </>
  );
}
