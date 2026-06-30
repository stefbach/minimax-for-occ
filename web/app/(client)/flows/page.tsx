import Link from "next/link";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { NewFlowButton } from "./NewFlowButton";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

type FlowRow = {
  id: string;
  name: string;
  description: string | null;
  start_step_id: string | null;
  updated_at: string;
  step_count: number;
};

async function loadFlows(): Promise<FlowRow[]> {
  if (!hasSupabase()) return [];
  const orgId = await currentOrgIdForServer();
  const sb = supabaseServer();
  const { data: flows } = await sb
    .from("flows")
    .select("id,name,description,start_step_id,updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });

  const ids = (flows ?? []).map((f) => f.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    // flow_steps inherit org via flow_id; flows query above already filtered.
    const { data: steps } = await sb.from("flow_steps").select("flow_id").in("flow_id", ids);
    for (const s of steps ?? []) counts[s.flow_id] = (counts[s.flow_id] ?? 0) + 1;
  }
  return (flows ?? []).map((f) => ({ ...f, step_count: counts[f.id] ?? 0 }));
}

export default async function FlowsPage() {
  const flows = await loadFlows();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Flows / IVR</h1>
          <div className="subtitle">
            {flows.length} flow{flows.length === 1 ? "" : "s"} · drag-and-drop visual builder
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NewFlowButton />
          <HelpButton contextKey="flows" />
        </div>
      </div>

      {!hasSupabase() ? (
        <div className="card">
          <h3>Supabase not configured</h3>
          <p className="muted">
            Go to <Link href="/settings">Settings</Link> or set{" "}
            <span className="kbd">SUPABASE_URL</span> and{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>.
          </p>
        </div>
      ) : flows.length === 0 ? (
        <div className="card">
          <h3>No flows yet</h3>
          <p className="muted">
            Click &lsquo;+ New flow&rsquo; to open the visual editor. Drag and drop steps
            (welcome, DTMF menu, gather speech, AI agent, transfer…) and connect them to
            define the call scenario.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Steps</th>
                <th>Start</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link
                      href={`/flows/${f.id}/edit`}
                      style={{ color: "var(--accent-2)", fontWeight: 600 }}
                    >
                      {f.name}
                    </Link>
                    {f.description && (
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{f.description}</div>
                    )}
                  </td>
                  <td>
                    <span className="tag">{f.step_count}</span>
                  </td>
                  <td>
                    {f.start_step_id ? (
                      <span className="tag good">set</span>
                    ) : (
                      <span className="tag">not set</span>
                    )}
                  </td>
                  <td style={{ color: "var(--muted)" }}>
                    {new Date(f.updated_at).toLocaleString()}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/flows/${f.id}/edit`}>
                      <button className="ghost" style={{ padding: "6px 10px" }}>
                        Open
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
