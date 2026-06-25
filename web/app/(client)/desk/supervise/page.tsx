import { redirect } from "next/navigation";
import { hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { SupervisePageClient } from "@/components/desk/SupervisePageClient";
import { SupervisePageHeader } from "@/components/desk/SupervisePageHeader";

export const dynamic = "force-dynamic";

// Roles allowed to manually reassign callback tasks. Mirrors the server-side
// guard in /api/desk/tasks/:id/reassign.
const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

export default async function DeskSupervisePage() {
  if (!hasSupabase()) {
    return (
      <div className="card" style={{ borderColor: "var(--bad)" }}>
        Supabase non configuré.
      </div>
    );
  }
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    redirect("/desk");
  }

  return (
    <div>
      <SupervisePageHeader />
      <SupervisePageClient />
    </div>
  );
}
