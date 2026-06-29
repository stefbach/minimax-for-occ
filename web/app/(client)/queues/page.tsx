import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { QueuesClient, type QueueRow, type AgentHandleOption } from "@/components/queues/QueuesClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default async function QueuesPage() {
  let queues: QueueRow[] = [];
  let handles: AgentHandleOption[] = [];

  if (hasSupabase()) {
    try {
      const orgId = await currentOrgIdForServer();
      const sb = supabaseServer();
      const [{ data: qs }, { data: hs }] = await Promise.all([
        sb
          .from("queues")
          .select("*")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false }),
        sb
          .from("agent_handles")
          .select("id, kind, display_name, active")
          .eq("org_id", orgId)
          .eq("active", true)
          .order("display_name", { ascending: true }),
      ]);
      queues = (qs ?? []) as QueueRow[];
      handles = (hs ?? []) as AgentHandleOption[];
    } catch {
      /* tables may not exist yet on this Supabase project — start empty */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Queues</h1>
          <div className="subtitle">
            {queues.length} queue{queues.length === 1 ? "" : "s"} · skill-based routing to AI + human agents
          </div>
        </div>
        <HelpButton contextKey="queues" />
      </div>
      <QueuesClient initial={queues} handles={handles} />
    </>
  );
}
