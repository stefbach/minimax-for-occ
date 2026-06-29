import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { NewAgentClient } from "@/components/agent/NewAgentClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  let orgCategory: string | null = null;
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const org = await currentOrgIdForServer();
      const { data } = await sb
        .from("organizations")
        .select("category")
        .eq("id", org)
        .maybeSingle();
      orgCategory = (data as { category: string | null } | null)?.category ?? null;
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>New agent</h1>
          <div className="subtitle">
            Telephony (speaks on calls, used in campaigns) or management (runs automations, used in workflows).
          </div>
        </div>
        <HelpButton contextKey="agents.detail" />
      </div>
      <NewAgentClient orgCategory={orgCategory} />
    </>
  );
}
