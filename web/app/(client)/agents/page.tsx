import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import type { Agent } from "@/lib/types";
import { HelpButton } from "@/components/help/HelpButton";
import { AgentsPageClient } from "@/components/agent/AgentsPageClient";

export const dynamic = "force-dynamic";

async function loadAgents(): Promise<Agent[]> {
  if (!hasSupabase()) return [];
  const orgId = await currentOrgIdForServer();
  const sb = supabaseServer();
  const { data } = await sb
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  return (data as Agent[]) ?? [];
}

export default async function AgentsPage() {
  const agents = await loadAgents();
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
        <HelpButton contextKey="agents" />
      </div>
      <AgentsPageClient agents={agents} supabaseReady={hasSupabase()} />
    </div>
  );
}
