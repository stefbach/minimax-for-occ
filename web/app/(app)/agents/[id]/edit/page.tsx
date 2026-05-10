import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { AgentForm } from "@/components/agent/AgentForm";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return (
      <div className="card">
        <h3>Supabase non configuré</h3>
        <p className="muted">Définissez les env vars Supabase pour éditer.</p>
      </div>
    );
  }
  const sb = supabaseServer();
  const { data } = await sb.from("agents").select("*").eq("id", id).maybeSingle();
  if (!data) return notFound();
  const agent = data as Agent;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Éditer · {agent.name}</h1>
          <div className="subtitle">
            <Link href={`/agents/${agent.id}`} style={{ color: "var(--muted)" }}>
              ← retour à la session
            </Link>
          </div>
        </div>
      </div>
      <AgentForm initial={agent} />
    </>
  );
}
