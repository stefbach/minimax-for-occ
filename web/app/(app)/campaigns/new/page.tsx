import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { CampaignWizard, type AgentHandleOption, type PhoneNumberOption, type ContactOption } from "@/components/campaigns/CampaignWizard";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

import { LEGACY_ORG_ID as DEFAULT_ORG } from "@/lib/constants";

export default async function NewCampaignPage() {
  let agents: AgentHandleOption[] = [];
  let numbers: PhoneNumberOption[] = [];
  let contacts: ContactOption[] = [];

  if (hasSupabase()) {
    const sb = supabaseServer();
    try {
      const { data } = await sb
        .from("agent_handles")
        .select("id,display_name,kind,ai_agent_id,active")
        .eq("org_id", DEFAULT_ORG)
        .eq("kind", "ai")
        .eq("active", true)
        .order("display_name", { ascending: true })
        .limit(200);
      const handles = (data ?? []) as Array<{
        id: string;
        display_name: string;
        kind: string;
        ai_agent_id: string | null;
      }>;
      // Enrich with the underlying agent's model/voice for display.
      const agentIds = handles
        .map((h) => h.ai_agent_id)
        .filter((x): x is string => Boolean(x));
      let agentInfo = new Map<string, { llm_model: string | null; tts_voice_id: string | null }>();
      if (agentIds.length > 0) {
        const { data: ags } = await sb
          .from("agents")
          .select("id,llm_model,tts_voice_id")
          .in("id", agentIds);
        for (const a of ags ?? []) {
          agentInfo.set(a.id as string, {
            llm_model: (a.llm_model as string) ?? null,
            tts_voice_id: (a.tts_voice_id as string) ?? null,
          });
        }
      }
      agents = handles.map((h) => ({
        id: h.id,
        display_name: h.display_name,
        llm_model: h.ai_agent_id ? agentInfo.get(h.ai_agent_id)?.llm_model ?? null : null,
        tts_voice_id: h.ai_agent_id ? agentInfo.get(h.ai_agent_id)?.tts_voice_id ?? null : null,
      }));
    } catch {
      /* ignore */
    }
    try {
      const { data } = await sb
        .from("phone_numbers")
        .select("id,e164,label,active")
        .eq("org_id", DEFAULT_ORG)
        .eq("active", true)
        .order("e164", { ascending: true })
        .limit(200);
      numbers = (data ?? []) as PhoneNumberOption[];
    } catch {
      /* ignore */
    }
    try {
      const { data } = await sb
        .from("contacts")
        .select("id,e164,display_name")
        .eq("org_id", DEFAULT_ORG)
        .order("updated_at", { ascending: false })
        .limit(500);
      contacts = (data ?? []) as ContactOption[];
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nouvelle campagne</h1>
          <div className="subtitle">Brouillon — vous pourrez démarrer la campagne après création.</div>
        </div>
        <HelpButton contextKey="campaigns" />
      </div>
      <CampaignWizard agents={agents} numbers={numbers} contacts={contacts} />
    </>
  );
}
