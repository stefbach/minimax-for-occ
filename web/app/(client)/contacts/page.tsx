import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { ContactsClient } from "@/components/contacts/ContactsClient";
import { HelpButton } from "@/components/help/HelpButton";
import { currentMembership, currentOrgFromCookie } from "@/lib/supabase-auth";
import { LEGACY_ORG_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Pick the active org from the cookie set by the OrgSwitcher, falling back
 *  to the user's primary membership, then the Legacy org as last resort.
 *  Previously the page hardcoded LEGACY_ORG_ID so the org selector in the
 *  sidebar had no effect on which contacts were listed. */
async function resolveOrgId(): Promise<string> {
  const fromCookie = await currentOrgFromCookie();
  if (fromCookie) return fromCookie;
  const membership = await currentMembership();
  return membership?.org_id ?? LEGACY_ORG_ID;
}

export default async function ContactsPage() {
  let initial: any[] = [];
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await resolveOrgId();
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
