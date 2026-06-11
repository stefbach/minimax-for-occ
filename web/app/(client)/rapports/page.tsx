import { redirect } from "next/navigation";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { ReportsClient } from "@/components/reports/ReportsClient";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
]);

export default async function RapportsPage() {
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !ALLOWED_ROLES.has(role)) {
    redirect("/desk");
  }
  return <ReportsClient />;
}
