import { redirect } from "next/navigation";
import { hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { TeamList } from "@/components/team/TeamList";

export const dynamic = "force-dynamic";

// Owner/Admin-only page to view and manage org members. Wave A = read-only
// list. Wave B will add invite, Wave C edit role / disable.

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

export default async function TeamPage() {
  if (!hasSupabase()) {
    return (
      <div className="card" style={{ borderColor: "var(--bad)" }}>
        Supabase non configuré.
      </div>
    );
  }
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    // Non-owner/admin shouldn't see this page — bounce them to the dashboard.
    redirect("/dashboard");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Équipe</h1>
          <div className="subtitle">
            Gérez les utilisateurs de votre organisation, leurs rôles et leurs accès.
          </div>
        </div>
        <button disabled title="Invitations bientôt disponibles">+ Inviter</button>
      </div>
      <TeamList />
    </>
  );
}
