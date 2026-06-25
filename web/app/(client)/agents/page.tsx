import Link from "next/link";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import type { Agent } from "@/lib/types";
import { HelpButton } from "@/components/help/HelpButton";

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
    <>
      <div className="page-header">
        <div>
          <h1>Agents</h1>
          <div className="subtitle">{agents.length} agent{agents.length === 1 ? "" : "s"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/agents/new"><button>+ New agent</button></Link>
          <HelpButton contextKey="agents" />
        </div>
      </div>

      {!hasSupabase() ? (
        <div className="card">
          <h3>Supabase not configured</h3>
          <p className="muted">
            Go to <Link href="/settings">Settings</Link> or set the env vars{" "}
            <span className="kbd">SUPABASE_URL</span> and{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span> in Vercel.
          </p>
        </div>
      ) : agents.length === 0 ? (
        <div className="card">
          <h3>No agents yet</h3>
          <p className="muted">Click &lsquo;New agent&rsquo; to get started.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>LLM</th>
                <th>Voice</th>
                <th>Language</th>
                <th>RAG</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/agents/${a.id}`} style={{ color: "var(--accent-2)", fontWeight: 600 }}>
                      {a.name}
                    </Link>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{a.description ?? ""}</div>
                  </td>
                  <td><span className="tag">{a.llm_provider}/{a.llm_model}</span></td>
                  <td>
                    {a.tts_voice_id ? <span className="kbd">{a.tts_voice_id}</span> : <em style={{ color: "var(--muted)" }}>default</em>}
                    {a.tts_model && <div style={{ color: "var(--muted)", fontSize: 11 }}>{a.tts_model}</div>}
                  </td>
                  <td>{a.language}</td>
                  <td>{a.rag_enabled ? <span className="tag good">on</span> : <span className="tag">off</span>}</td>
                  <td style={{ color: "var(--muted)" }}>{new Date(a.updated_at).toLocaleString()}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/agents/${a.id}/edit`}>
                      <button className="ghost" style={{ padding: "6px 10px" }}>Edit</button>
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
