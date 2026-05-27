import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import type { Agent } from "@/lib/types";
import { AgentSession } from "@/components/agent/AgentSession";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  if (!hasSupabase()) {
    return (
      <div className="card">
        <h3>Supabase non configuré</h3>
        <p className="muted">Définissez les env vars Supabase pour ouvrir un agent.</p>
      </div>
    );
  }
  const sb = supabaseServer();
  const { data } = await sb.from("agents").select("*").eq("id", id).maybeSingle();
  if (!data) return notFound();
  const agent = data as Agent;
  return <AgentSession agent={agent} initialTab={tab ?? "session"} />;
}
