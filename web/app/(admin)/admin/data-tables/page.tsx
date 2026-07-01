import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentMembership } from "@/lib/supabase-auth";
import { redirect } from "next/navigation";
import { AdminDataTablesClient, type OrgOption } from "@/components/admin/AdminDataTablesClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default async function AdminDataTablesPage() {
  // Gate: super_admin only.
  let isSuper = false;
  try {
    const m = await currentMembership();
    // currentMembership returns one membership; super_admin is global so we
    // double-check against the memberships table.
    if (m?.role === "super_admin") isSuper = true;
    else if (hasSupabase()) {
      const sb = supabaseServer();
      const { data } = await sb.auth.getUser?.() ?? { data: null };
      // Fallback: check any super_admin membership for this user.
      const userId = (data as { user?: { id?: string } } | null)?.user?.id;
      if (userId) {
        const { data: rows } = await sb
          .from("memberships")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .limit(1);
        if ((rows ?? []).length > 0) isSuper = true;
      }
    }
  } catch {
    isSuper = false;
  }
  if (!isSuper) redirect("/dashboard");

  let orgs: OrgOption[] = [];
  if (hasSupabase()) {
    const sb = supabaseServer();
    const { data } = await sb
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });
    orgs = (data ?? []) as OrgOption[];
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tables de données — assignation</h1>
          <div className="subtitle">
            Attribuez des tables physiques (importées dans Supabase) aux clients. Chaque client ne
            voit que ses tables attribuées.
          </div>
        </div>
        <HelpButton contextKey="admin.data-tables" />
      </div>
      <AdminDataTablesClient orgs={orgs} />
    </>
  );
}
