import Link from "next/link";
import { BrainHero } from "@/components/brand/BrainHero";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import type { Agent } from "@/lib/types";

async function loadAgents(): Promise<Agent[]> {
  if (!hasSupabase()) return [];
  try {
    const sb = supabaseServer();
    const { data } = await sb
      .from("agents")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(6);
    return (data as Agent[]) ?? [];
  } catch {
    return [];
  }
}

export default async function Landing() {
  const agents = await loadAgents();

  return (
    <>
      <section className="hero">
        <div>
          <h1>Le cerveau de vos agents vocaux IA.</h1>
          <p className="lede">
            Axon orchestre des agents vocaux multilingues sur LiveKit : voix MiniMax (clonage),
            cerveau OpenAI ou Anthropic, RAG Supabase pgvector, déclenchement n8n. Tout se
            paramètre depuis cette console — pas de YAML, pas de redeploy à chaque changement.
          </p>
          <div className="cta-row">
            <Link href="/agents/new"><button>+ Créer un agent</button></Link>
            <Link href="/agents"><button className="ghost">Voir mes agents</button></Link>
          </div>
        </div>
        <BrainHero />
      </section>

      <section style={{ marginTop: 14 }}>
        <div className="page-header" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Agents récents</h2>
            <div className="subtitle">Cliquez pour entrer en session vocale ou éditer la configuration.</div>
          </div>
          <Link href="/agents"><button className="ghost">Tous les agents →</button></Link>
        </div>

        {!hasSupabase() ? (
          <div className="card">
            <h3>Supabase non configuré</h3>
            <p className="muted">
              Définissez <span className="kbd">SUPABASE_URL</span> et{" "}
              <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span> dans Vercel, puis appliquez la
              migration SQL <span className="kbd">supabase/migrations/0001_axon_init.sql</span>.
            </p>
          </div>
        ) : agents.length === 0 ? (
          <div className="card">
            <h3>Pas encore d&apos;agent</h3>
            <p className="muted">Commencez par en créer un.</p>
            <div style={{ marginTop: 12 }}>
              <Link href="/agents/new"><button>+ Créer mon premier agent</button></Link>
            </div>
          </div>
        ) : (
          <div className="grid cols-3">
            {agents.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="card" style={{ textDecoration: "none" }}>
                <h3>{a.name}</h3>
                <p className="muted" style={{ minHeight: 36 }}>
                  {a.description ?? <em>Pas de description</em>}
                </p>
                <div className="row" style={{ flexWrap: "wrap", marginTop: 10 }}>
                  <span className="tag">{a.language}</span>
                  <span className="tag">{a.llm_provider}/{a.llm_model}</span>
                  {a.rag_enabled && <span className="tag good">RAG</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
