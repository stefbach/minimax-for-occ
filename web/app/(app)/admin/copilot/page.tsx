import { redirect } from "next/navigation";
import { currentMembership } from "@/lib/supabase-auth";
import { CopilotClient } from "@/components/admin/CopilotClient";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const m = await currentMembership();
  if (!m || m.role !== "super_admin") {
    // Middleware allows /admin/* for both super_admin and admin, but this
    // sub-route is strictly super_admin-only.
    redirect("/admin");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Copilote Super Admin</h1>
          <div className="subtitle">
            Pilote la plateforme par chat — n8n, Supabase, agents IA, RAG.
            Les actions destructives demandent toujours une confirmation explicite.
          </div>
        </div>
      </div>
      <CopilotClient />
    </>
  );
}
