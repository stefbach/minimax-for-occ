import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentUser } from "@/lib/supabase-auth";
import { OrgsAdminClient, type OrgRow } from "@/components/admin/OrgsAdminClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default async function SuperAdminOrgsPage() {
  let rows: OrgRow[] = [];
  let forbidden = false;
  let isSuper = false;

  if (hasSupabase()) {
    try {
      const user = await currentUser();
      const sb = supabaseServer();
      if (user) {
        const { data: myRoles } = await sb
          .from("memberships")
          .select("role")
          .eq("user_id", user.id);
        isSuper = (myRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
      }
      if (!isSuper) {
        forbidden = true;
      } else {
        const { data: orgs } = await sb
          .from("organizations")
          .select("id, name, slug, category, created_at, active, status, deletion_scheduled_at")
          .order("created_at", { ascending: true });

        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        rows = await Promise.all(
          (orgs ?? []).map(async (o: {
            id: string;
            name: string;
            slug: string;
            category: string | null;
            created_at: string;
            active?: boolean;
            status?: "active" | "suspended" | "archived" | "pending_deletion";
            deletion_scheduled_at?: string | null;
          }) => {
            const [mem, calls] = await Promise.all([
              sb.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", o.id),
              sb
                .from("calls")
                .select("id", { count: "exact", head: true })
                .eq("org_id", o.id)
                .gte("started_at", since),
            ]);
            return {
              id: o.id,
              name: o.name,
              slug: o.slug,
              category: o.category ?? null,
              created_at: o.created_at,
              active: o.active ?? true,
              status: o.status ?? (o.active === false ? "suspended" : "active"),
              deletion_scheduled_at: o.deletion_scheduled_at ?? null,
              members: mem.count ?? 0,
              calls_7d: calls.count ?? 0,
            };
          }),
        );
      }
    } catch {
      /* fall through, render empty state */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            Organisations <span className="tag" style={{ marginLeft: 8 }}>Vue super_admin</span>
          </h1>
          <div className="subtitle">
            Vue plateforme : toutes les organisations, leur effectif et leur activité récente.
          </div>
        </div>
        <HelpButton contextKey="admin.orgs" />
      </div>

      {forbidden ? (
        <div className="card" style={{ color: "var(--bad)" }}>
          Accès refusé : seuls les utilisateurs <span className="kbd">super_admin</span> peuvent voir
          cette page.
        </div>
      ) : (
        <OrgsAdminClient initial={rows} />
      )}
    </>
  );
}
