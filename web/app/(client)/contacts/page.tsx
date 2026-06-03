import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { ContactsClient } from "@/components/contacts/ContactsClient";
import { HelpButton } from "@/components/help/HelpButton";
import { currentOrgIdForServer } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  let initial: any[] = [];
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();
      const { data } = await sb
        .from("contacts")
        .select("*")
        .eq("org_id", orgId)
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
        <HelpButton contextKey="contacts" />
      </div>
      <ContactsClient initial={initial} />
    </>
  );
}
