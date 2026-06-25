"use client";

import Link from "next/link";
import { BrainHero } from "@/components/brand/BrainHero";
import type { Agent } from "@/lib/types";

export function LandingContent({
  target,
  role,
  agents,
}: {
  target: string;
  role: string | null | undefined;
  agents: Agent[];
}) {
  return (
    <>
      <section className="hero">
        <div>
          <h1>The command centre for your voice operations.</h1>
          <p className="lede">
            Axon orchestrates AI agents and human agents on the same number, on the same queue. Inbound + outbound. Twilio telephony, MiniMax voice, OpenAI / Anthropic / MiniMax brain, Supabase RAG, visual flows, live supervision.
          </p>
          <div className="cta-row">
            <Link href={target}><button>Go to my workspace · {target}</button></Link>
            {role && role !== "agent" && (
              <Link href="/agents/new"><button className="ghost">+ New AI agent</button></Link>
            )}
          </div>
        </div>
        <BrainHero />
      </section>

      {role && role !== "agent" && (
        <section style={{ marginTop: 14 }}>
          <div className="page-header" style={{ marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Recent AI agents</h2>
              <div className="subtitle">Click to open the session or edit the configuration.</div>
            </div>
            <Link href="/agents"><button className="ghost">All agents →</button></Link>
          </div>

          {agents.length === 0 ? (
            <div className="card">
              <h3>No AI agents yet</h3>
              <p className="muted">Start by creating one.</p>
              <div style={{ marginTop: 12 }}>
                <Link href="/agents/new"><button>+ Create my first agent</button></Link>
              </div>
            </div>
          ) : (
            <div className="grid cols-3">
              {agents.map((a) => (
                <Link key={a.id} href={`/agents/${a.id}`} className="card" style={{ textDecoration: "none" }}>
                  <h3>{a.name}</h3>
                  <p className="muted" style={{ minHeight: 36 }}>
                    {a.description ?? <em>No description</em>}
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
