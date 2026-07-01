import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { HelpButton } from "@/components/help/HelpButton";
import { CampaignRowActions } from "@/components/campaigns/CampaignRowActions";

export const dynamic = "force-dynamic";

import { currentOrgIdForServer } from "@/lib/supabase-auth";

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  state: string;
  agent_handle_id: string | null;
  created_at: string;
}

interface AgentHandleRow {
  id: string;
  display_name: string;
}

interface TargetCount {
  campaign_id: string;
  status: string;
}

function stateTag(state: string): string {
  switch (state) {
    case "running":
      return "tag good";
    case "draft":
      return "tag";
    case "paused":
      return "tag";
    case "completed":
      return "tag accent";
    case "cancelled":
      return "tag";
    case "scheduled":
      return "tag accent";
    default:
      return "tag";
  }
}

export default async function CampaignsPage() {
  let campaigns: CampaignRow[] = [];
  let handleMap = new Map<string, string>();
  let countsMap = new Map<string, { total: number; done: number }>();

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const DEFAULT_ORG = await currentOrgIdForServer();
      const { data } = await sb
        .from("campaigns")
        .select("id,name,description,state,agent_handle_id,created_at")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(500);
      campaigns = (data ?? []) as CampaignRow[];

      const handleIds = Array.from(
        new Set(campaigns.map((c) => c.agent_handle_id).filter(Boolean)),
      ) as string[];
      if (handleIds.length > 0) {
        const { data: handles } = await sb
          .from("agent_handles")
          .select("id,display_name")
          .in("id", handleIds);
        for (const h of (handles ?? []) as AgentHandleRow[]) {
          handleMap.set(h.id, h.display_name);
        }
      }

      const ids = campaigns.map((c) => c.id);
      if (ids.length > 0) {
        const { data: targets } = await sb
          .from("campaign_targets")
          .select("campaign_id,status")
          .in("campaign_id", ids);
        for (const t of (targets ?? []) as TargetCount[]) {
          const c = countsMap.get(t.campaign_id) ?? { total: 0, done: 0 };
          c.total += 1;
          if (t.status === "done" || t.status === "answered") c.done += 1;
          countsMap.set(t.campaign_id, c);
        }
      }
    } catch {
      /* table may not exist — start empty */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Outbound campaigns</h1>
          <div className="subtitle">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/campaigns/new">
            <button>+ New campaign</button>
          </Link>
          <HelpButton contextKey="campaigns" />
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="card">
          <h3>No campaigns</h3>
          <p className="muted" style={{ margin: 0 }}>
            Create your first outbound call campaign to run an AI agent over a contact list.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Agent</th>
                <th>Targets</th>
                <th>Progress</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const counts = countsMap.get(c.id) ?? { total: 0, done: 0 };
                const pct = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/campaigns/${c.id}`} style={{ fontWeight: 600 }}>
                        {c.name}
                      </Link>
                      {c.description && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={stateTag(c.state)}>{c.state}</span>
                    </td>
                    <td>{handleMap.get(c.agent_handle_id ?? "") ?? "—"}</td>
                    <td>{counts.total}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 80,
                            height: 6,
                            background: "var(--bg-2)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: "var(--accent)",
                            }}
                          />
                        </div>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <CampaignRowActions id={c.id} name={c.name} state={c.state} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
