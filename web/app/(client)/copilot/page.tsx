import { CopilotPanel } from "@/components/dashboard/CopilotPanel";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { hasSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const orgId = hasSupabase() ? await currentOrgIdForServer() : undefined;
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Co-pilot manager</h1>
          <div className="subtitle">
            Pose une question en langage naturel sur l&apos;activité de tes appels.
          </div>
        </div>
      </div>
      <CopilotPanel orgId={orgId} fullPage />
    </>
  );
}
