import { OutboundCallClient } from "@/components/outbound/OutboundCallClient";
import { HelpButton } from "@/components/help/HelpButton";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

/**
 * /outbound-call — "Make an outbound call" page (à la Retell). Lets an
 * operator dial ONE number with ONE AI agent immédiatement, sans créer
 * de campagne ni de target. The per-agent shortcut button (top-right
 * of /agents/[id]) opens the OutboundCallModal — this page is the
 * standalone variant with an agent picker.
 */
export default async function OutboundCallPage() {
  let agents: Array<{ id: string; name: string; voice: string | null }> = [];
  let scripts: Array<{ id: string; name: string }> = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const orgId = await currentOrgIdForServer();

      const { data: agentRows } = await sb
        .from("agents")
        .select("id, name, tts_voice_id")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(200);
      agents = (agentRows ?? []).map((a) => ({
        id: a.id as string,
        name: (a.name as string) ?? "(sans nom)",
        voice: (a.tts_voice_id as string | null) ?? null,
      }));

      const { data: scriptRows } = await sb
        .from("scripts")
        .select("id, name")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      scripts = (scriptRows ?? []).map((s) => ({
        id: s.id as string,
        name: (s.name as string) ?? "(sans nom)",
      }));
    } catch {
      /* empty lists if RLS / missing tables */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Appel sortant immédiat</h1>
          <div className="subtitle">
            Appelle un numéro maintenant avec un agent IA. Pas de campagne
            ni de target à créer.
          </div>
        </div>
        <HelpButton contextKey="outbound-call" />
      </div>
      <OutboundCallClient agents={agents} scripts={scripts} />
    </>
  );
}
