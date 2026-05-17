import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { QueuesClient, type QueueRow, type AgentHandleOption } from "@/components/queues/QueuesClient";

export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

export default async function QueuesPage() {
  let queues: QueueRow[] = [];
  let handles: AgentHandleOption[] = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const [{ data: qs }, { data: hs }] = await Promise.all([
        sb
          .from("queues")
          .select("*")
          .eq("org_id", DEFAULT_ORG)
          .order("created_at", { ascending: false }),
        sb
          .from("agent_handles")
          .select("id, kind, display_name, active")
          .eq("org_id", DEFAULT_ORG)
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
          <h1>Files d&apos;attente</h1>
          <div className="subtitle">
            {queues.length} file{queues.length === 1 ? "" : "s"} · routage skill-based vers les agents AI + humains
          </div>
        </div>
      </div>
      <QueuesClient initial={queues} handles={handles} />
    </>
  );
}
