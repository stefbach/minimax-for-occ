import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentMembership, landingPathFor } from "@/lib/supabase-auth";
import { LandingContent } from "@/components/brand/LandingContent";
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

  return <LandingContent target={target} role={role} agents={agents} />;
}
