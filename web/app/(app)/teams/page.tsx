import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { TeamsClient, type TeamRow, type AgentOption } from "@/components/teams/TeamsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

import { LEGACY_ORG_ID as DEFAULT_ORG } from "@/lib/constants";

export default async function TeamsPage() {
  let teams: TeamRow[] = [];
  let agents: AgentOption[] = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const [{ data: ts }, { data: ags }] = await Promise.all([
        sb
          .from("agent_teams")
          .select("*")
          .eq("org_id", DEFAULT_ORG)
          .order("created_at", { ascending: false }),
        sb
          .from("agents")
          .select("id, name, description")
          .eq("org_id", DEFAULT_ORG)
          .order("name", { ascending: true }),
      ]);
      teams = (ts ?? []) as TeamRow[];
      agents = (ags ?? []) as AgentOption[];
    } catch {
      /* tables may not exist on this Supabase project yet */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Teams IA</h1>
          <div className="subtitle">
            {teams.length} team{teams.length === 1 ? "" : "s"} · des agents qui peuvent se passer la parole en cours d&apos;appel (swarm)
          </div>
        </div>
        <HelpButton contextKey="teams" />
      </div>
      <TeamsClient initial={teams} agents={agents} />
    </>
  );
}
