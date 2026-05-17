import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentUser } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  members: number;
  calls_7d: number;
}

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
          .select("id, name, slug, created_at")
          .order("created_at", { ascending: true });

        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        rows = await Promise.all(
          (orgs ?? []).map(async (o) => {
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
              created_at: o.created_at,
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

  function fmt(dt: string): string {
    try {
      return new Date(dt).toLocaleDateString("fr-FR");
    } catch {
      return dt;
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
      </div>

      {forbidden ? (
        <div className="card" style={{ color: "var(--bad)" }}>
          Accès refusé : seuls les utilisateurs <span className="kbd">super_admin</span> peuvent voir
          cette page.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {rows.length === 0 ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>Aucune organisation.</div>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Slug</th>
                  <th style={{ textAlign: "right" }}>Membres</th>
                  <th style={{ textAlign: "right" }}>Appels (7j)</th>
                  <th>Créée le</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>
                      <span className="kbd">{r.slug}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>{r.members}</td>
                    <td style={{ textAlign: "right" }}>{r.calls_7d}</td>
                    <td style={{ color: "var(--muted)", fontSize: 13 }}>{fmt(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
