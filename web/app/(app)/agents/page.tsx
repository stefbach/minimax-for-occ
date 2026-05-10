import Link from "next/link";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadAgents(): Promise<Agent[]> {
  if (!hasSupabase()) return [];
  const sb = supabaseServer();
  const { data } = await sb.from("agents").select("*").order("updated_at", { ascending: false });
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
        <Link href="/agents/new"><button>+ Nouvel agent</button></Link>
      </div>

      {!hasSupabase() ? (
        <div className="card">
          <h3>Supabase non configuré</h3>
          <p className="muted">
            Allez dans <Link href="/settings">Paramètres</Link> ou définissez les env vars{" "}
            <span className="kbd">SUPABASE_URL</span> et{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span> dans Vercel.
          </p>
        </div>
      ) : agents.length === 0 ? (
        <div className="card">
          <h3>Vous n&apos;avez pas encore d&apos;agent</h3>
          <p className="muted">Cliquez « Nouvel agent » pour commencer.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Nom</th>
                <th>LLM</th>
                <th>Voix</th>
                <th>Langue</th>
                <th>RAG</th>
                <th>Mis à jour</th>
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
                  <td>{a.tts_voice_id ?? <em style={{ color: "var(--muted)" }}>défaut</em>}</td>
                  <td>{a.language}</td>
                  <td>{a.rag_enabled ? <span className="tag good">on</span> : <span className="tag">off</span>}</td>
                  <td style={{ color: "var(--muted)" }}>{new Date(a.updated_at).toLocaleString()}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/agents/${a.id}/edit`}>
                      <button className="ghost" style={{ padding: "6px 10px" }}>Éditer</button>
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
