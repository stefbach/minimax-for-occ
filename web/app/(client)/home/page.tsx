import Link from "next/link";
import { BrainHero } from "@/components/brand/BrainHero";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentMembership, landingPathFor } from "@/lib/supabase-auth";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadAgents(orgId: string | null): Promise<Agent[]> {
  if (!hasSupabase()) return [];
  if (!orgId) return [];
  try {
    const sb = supabaseServer();
    const { data } = await sb
      .from("agents")
      .select("*")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(6);
    return (data as Agent[]) ?? [];
  } catch {
    return [];
  }
}

export default async function Landing() {
  let m: Awaited<ReturnType<typeof currentMembership>> = null;
  try {
    m = await currentMembership();
  } catch {
    m = null;
  }
  const role = m?.role;
  const target = landingPathFor(role);
  const agents = await loadAgents(m?.org_id ?? null);

  return (
    <>
      <section className="hero">
        <div>
          <h1>Le centre de pilotage de vos opérations vocales.</h1>
          <p className="lede">
            Axon orchestre des agents IA et des agents humains sur le même numéro, sur la même
            file d&apos;attente. Inbound + outbound. Téléphonie Twilio, voix MiniMax, cerveau
            OpenAI / Anthropic / MiniMax, RAG Supabase, flows visuels, supervision live.
          </p>
          <div className="cta-row">
            <Link href={target}><button>Aller à mon espace · {target}</button></Link>
            {role && role !== "agent" && (
              <Link href="/agents/new"><button className="ghost">+ Nouvel agent IA</button></Link>
            )}
          </div>
        </div>
        <BrainHero />
      </section>

      {role && role !== "agent" && (
        <section style={{ marginTop: 14 }}>
          <div className="page-header" style={{ marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Agents IA récents</h2>
              <div className="subtitle">Cliquez pour ouvrir la session ou éditer la configuration.</div>
            </div>
            <Link href="/agents"><button className="ghost">Tous les agents →</button></Link>
          </div>

          {agents.length === 0 ? (
            <div className="card">
              <h3>Pas encore d&apos;agent IA</h3>
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
      )}
    </>
  );
}
