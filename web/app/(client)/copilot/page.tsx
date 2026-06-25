import { CopilotPanel } from "@/components/dashboard/CopilotPanel";
import { CopilotPageHeader } from "@/components/dashboard/CopilotPageHeader";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { hasSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const orgId = hasSupabase() ? await currentOrgIdForServer() : undefined;
  return (
    <>
      <CopilotPageHeader />
      <CopilotPanel orgId={orgId} fullPage />
    </>
  );
}
