"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
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
  const t = useT();

  return (
    <>
      <section className="hero">
        <div>
          <h1>{t("Le centre de pilotage de vos opérations vocales.")}</h1>
          <p className="lede">
            {t("Axon orchestre des agents IA et des agents humains sur le même numéro, sur la même file d'attente. Inbound + outbound. Téléphonie Twilio, voix MiniMax, cerveau OpenAI / Anthropic / MiniMax, RAG Supabase, flows visuels, supervision live.")}
          </p>
          <div className="cta-row">
            <Link href={target}><button>{t("Aller à mon espace")} · {target}</button></Link>
            {role && role !== "agent" && (
              <Link href="/agents/new"><button className="ghost">+ {t("Nouvel agent IA")}</button></Link>
            )}
          </div>
        </div>
        <BrainHero />
      </section>

      {role && role !== "agent" && (
        <section style={{ marginTop: 14 }}>
          <div className="page-header" style={{ marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{t("Agents IA récents")}</h2>
              <div className="subtitle">{t("Cliquez pour ouvrir la session ou éditer la configuration.")}</div>
            </div>
            <Link href="/agents"><button className="ghost">{t("Tous les agents")} →</button></Link>
          </div>

          {agents.length === 0 ? (
            <div className="card">
              <h3>{t("Pas encore d'agent IA")}</h3>
              <p className="muted">{t("Commencez par en créer un.")}</p>
              <div style={{ marginTop: 12 }}>
                <Link href="/agents/new"><button>+ {t("Créer mon premier agent")}</button></Link>
              </div>
            </div>
          ) : (
            <div className="grid cols-3">
              {agents.map((a) => (
                <Link key={a.id} href={`/agents/${a.id}`} className="card" style={{ textDecoration: "none" }}>
                  <h3>{a.name}</h3>
                  <p className="muted" style={{ minHeight: 36 }}>
                    {a.description ?? <em>{t("Pas de description")}</em>}
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
