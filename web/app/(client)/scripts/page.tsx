import { ScriptsClient, type AgentHandleOption } from "@/components/scripts/ScriptsClient";
import { HelpButton } from "@/components/help/HelpButton";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default async function ScriptsPage() {
  // Load all active agent_handles for this org (AI + human) so each script
  // node can opt into overriding the campaign's primary agent.
  let handles: AgentHandleOption[] = [];
  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();
      const { data } = await sb
        .from("agent_handles")
        .select("id,display_name,kind,ai_agent_id,active")
        .eq("org_id", orgId)
        .eq("active", true)
        .order("kind", { ascending: true })
        .order("display_name", { ascending: true });
      handles = (data ?? []).map((h) => ({
        id: h.id as string,
        display_name: (h.display_name as string) ?? "(sans nom)",
        kind: ((h.kind as string) === "human" ? "human" : "ai") as "ai" | "human",
        ai_agent_id: (h.ai_agent_id as string | null) ?? null,
      }));
    } catch {
      /* empty list if the table doesn't exist yet */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Scripts</h1>
          <div className="subtitle">
            Playbooks d&apos;appel versionnés, réutilisables par les campagnes
          </div>
        </div>
        <HelpButton contextKey="scripts" />
      </div>
      <ScriptsClient handles={handles} />
    </>
  );
}
