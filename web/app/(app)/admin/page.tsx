import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { AdminClient } from "@/components/admin/AdminClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

export default async function AdminPage() {
  let org: { id: string; name: string; slug: string } | null = null;
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const { data } = await sb
        .from("organizations")
        .select("id, name, slug")
        .eq("id", DEFAULT_ORG)
        .maybeSingle();
      org = data ?? null;
    } catch {
      /* table might not exist yet — render with placeholders */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Administration</h1>
          <div className="subtitle">
            Gestion des utilisateurs, invitations et paramètres de l&apos;organisation.
          </div>
        </div>
        <HelpButton contextKey="admin" />
      </div>
      <AdminClient
        orgId={org?.id ?? DEFAULT_ORG}
        orgName={org?.name ?? "Legacy"}
        orgSlug={org?.slug ?? "legacy"}
      />
    </>
  );
}
