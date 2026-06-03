import Link from "next/link";
import { notFound } from "next/navigation";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { TeamFlowEditor, type TeamMemberRow, type AgentOption } from "@/components/teams/TeamFlowEditor";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return (
      <div className="card">
        <h3>Supabase non configuré</h3>
      </div>
    );
  }
  const orgId = await currentOrgIdForServer();
  const sb = supabaseServer();

  const { data: team } = await sb
    .from("agent_teams")
    .select("id, name, description, lead_agent_id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!team) return notFound();

  const [{ data: members }, { data: agents }] = await Promise.all([
    sb
      .from("agent_team_members")
      .select("id, agent_id, specialty, transfer_description, priority, agent:agents(id, name, description)")
      .eq("team_id", id)
      .order("priority", { ascending: true }),
    sb
      .from("agents")
      .select("id, name, description")
      .eq("org_id", orgId)
      .order("name", { ascending: true }),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{team.name}</h1>
          <div className="subtitle">
            <Link href="/teams" style={{ color: "var(--muted)" }}>
              ← Teams IA
            </Link>
            {" · "}
            {(members ?? []).length} agent{(members ?? []).length === 1 ? "" : "s"} dans le parcours
          </div>
        </div>
      </div>
      {team.description && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>{team.description}</p>
      )}

      <TeamFlowEditor
        teamId={team.id}
        teamName={team.name}
        leadAgentId={team.lead_agent_id}
        initialMembers={(members ?? []).map((row) => {
          // Supabase's typegen returns the joined `agent` as an array when the
          // relationship is ambiguous; in our schema it's 1-to-1 (FK → agents.id)
          // so we flatten it back to a single object for the editor.
          const r = row as unknown as Record<string, unknown>;
          const rawAgent = r.agent;
          const agent = Array.isArray(rawAgent)
            ? (rawAgent[0] as { id: string; name: string; description: string | null } | undefined) ?? null
            : ((rawAgent as { id: string; name: string; description: string | null } | null) ?? null);
          return {
            id: r.id as string,
            agent_id: r.agent_id as string,
            specialty: (r.specialty as string | null) ?? null,
            transfer_description: (r.transfer_description as string | null) ?? null,
            priority: r.priority as number,
            agent,
          } satisfies TeamMemberRow;
        })}
        availableAgents={(agents ?? []) as AgentOption[]}
      />
    </>
  );
}
