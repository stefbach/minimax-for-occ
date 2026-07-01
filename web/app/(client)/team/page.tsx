import { redirect } from "next/navigation";
import { hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { TeamPageClient } from "@/components/team/TeamPageClient";

export const dynamic = "force-dynamic";

// Owner/Admin-only page to view and manage org members. Wave A = read-only
// list. Wave B = invitations (create + manage). Wave C = edit role / disable.

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

export default async function TeamPage() {
  if (!hasSupabase()) {
    return (
      <div className="card" style={{ borderColor: "var(--bad)" }}>
        Supabase not configured.
      </div>
    );
  }
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    // Non-owner/admin shouldn't see this page — bounce them to the dashboard.
    redirect("/dashboard");
  }

  return <TeamPageClient />;
}
