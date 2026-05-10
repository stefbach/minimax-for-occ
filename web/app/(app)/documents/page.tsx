import Link from "next/link";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SourceRow {
  agent_id: string;
  agent_name: string;
  source_name: string;
  chunks: number;
  rag_enabled: boolean;
}

async function loadSources(): Promise<SourceRow[]> {
  if (!hasSupabase()) return [];
  const sb = supabaseServer();
  const { data: agents } = await sb.from("agents").select("id, name, rag_enabled");
  const agentList = (agents as Pick<Agent, "id" | "name" | "rag_enabled">[]) ?? [];
  const out: SourceRow[] = [];
  for (const a of agentList) {
    const { data } = await sb
      .from("documents")
      .select("source_name")
      .eq("agent_id", a.id);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { source_name: string }[]) {
      counts.set(r.source_name, (counts.get(r.source_name) ?? 0) + 1);
    }
    for (const [source, chunks] of counts) {
      out.push({ agent_id: a.id, agent_name: a.name, source_name: source, chunks, rag_enabled: a.rag_enabled });
    }
  }
  return out;
}

export default async function DocumentsPage() {
  const sources = await loadSources();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Documents (RAG)</h1>
          <div className="subtitle">{sources.length} source{sources.length === 1 ? "" : "s"} indexée{sources.length === 1 ? "" : "s"}.</div>
        </div>
      </div>

      {!hasSupabase() ? (
        <div className="card">
          <h3>Supabase non configuré</h3>
          <p className="muted">Vous devez avoir Supabase + l&apos;extension pgvector pour stocker les embeddings.</p>
        </div>
      ) : sources.length === 0 ? (
        <div className="card">
          <h3>Aucun document indexé</h3>
          <p className="muted">
            Allez sur la page d&apos;un agent → onglet « RAG / Documents » pour ajouter du contenu.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead><tr><th>Agent</th><th>Source</th><th>Fragments</th><th></th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={`${s.agent_id}:${s.source_name}`}>
                  <td>
                    <Link href={`/agents/${s.agent_id}?tab=rag`} style={{ color: "var(--accent-2)", fontWeight: 600 }}>
                      {s.agent_name}
                    </Link>
                    {!s.rag_enabled && <span className="tag" style={{ marginLeft: 6 }}>RAG off</span>}
                  </td>
                  <td>{s.source_name}</td>
                  <td>{s.chunks}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/agents/${s.agent_id}?tab=rag`}>
                      <button className="ghost" style={{ padding: "5px 9px" }}>Gérer</button>
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
