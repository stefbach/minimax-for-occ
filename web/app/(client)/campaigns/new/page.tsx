import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { CampaignWizard, type AgentHandleOption, type PhoneNumberOption, type ContactOption, type ScriptOption, type TeamOption, type ContactListOption } from "@/components/campaigns/CampaignWizard";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

import { currentOrgIdForServer } from "@/lib/supabase-auth";

export default async function NewCampaignPage() {
  let agents: AgentHandleOption[] = [];
  let numbers: PhoneNumberOption[] = [];
  let contacts: ContactOption[] = [];
  let scripts: ScriptOption[] = [];
  let teams: TeamOption[] = [];
  let contactLists: ContactListOption[] = [];

  if (hasSupabase()) {
    const sb = supabaseServer();
    const DEFAULT_ORG = await currentOrgIdForServer();
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
    try {
      const { data } = await sb
        .from("scripts")
        .select("id,name,mission,description")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(200);
      scripts = (data ?? []) as ScriptOption[];
    } catch {
      /* ignore */
    }
    try {
      // Teams + their lead agent's handle (so picking a team auto-selects
      // the right answering agent without an extra step for the user).
      const { data: ts } = await sb
        .from("agent_teams")
        .select("id,name,description,lead_agent_id")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(100);
      const teamRows = (ts ?? []) as Array<{
        id: string;
        name: string;
        description: string | null;
        lead_agent_id: string | null;
      }>;
      // Member counts + lead handle resolution (lead_agent → ai_agent_id handle).
      const leadIds = teamRows.map((t) => t.lead_agent_id).filter((x): x is string => Boolean(x));
      const handleByAgent = new Map<string, string>();
      if (leadIds.length > 0) {
        const { data: hs } = await sb
          .from("agent_handles")
          .select("id,ai_agent_id")
          .eq("org_id", DEFAULT_ORG)
          .eq("kind", "ai")
          .in("ai_agent_id", leadIds);
        for (const h of hs ?? []) {
          const aid = (h as { ai_agent_id: string | null }).ai_agent_id;
          if (aid) handleByAgent.set(aid, (h as { id: string }).id);
        }
      }
      const teamIds = teamRows.map((t) => t.id);
      const memberCount: Record<string, number> = {};
      if (teamIds.length > 0) {
        const { data: ms } = await sb
          .from("agent_team_members")
          .select("team_id")
          .in("team_id", teamIds);
        for (const m of ms ?? []) {
          const tid = (m as { team_id: string }).team_id;
          memberCount[tid] = (memberCount[tid] ?? 0) + 1;
        }
      }
      teams = teamRows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        lead_agent_handle_id: t.lead_agent_id ? handleByAgent.get(t.lead_agent_id) ?? null : null,
        member_count: memberCount[t.id] ?? 0,
      }));
    } catch {
      /* ignore */
    }
    try {
      // Bases de Contacts the user can pick to source the campaign's targets
      // from, without manually picking individual contacts.
      const { data } = await sb
        .from("contact_lists")
        .select("id,name,description")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(200);
      const baseRows = (data ?? []) as Array<{ id: string; name: string; description: string | null }>;
      const ids = baseRows.map((b) => b.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: cs } = await sb
          .from("contacts")
          .select("list_id")
          .eq("org_id", DEFAULT_ORG)
          .in("list_id", ids);
        for (const c of cs ?? []) {
          const k = (c as { list_id: string }).list_id;
          counts[k] = (counts[k] ?? 0) + 1;
        }
      }
      contactLists = baseRows.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        contact_count: counts[b.id] ?? 0,
      }));
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
      <CampaignWizard
        agents={agents}
        numbers={numbers}
        contacts={contacts}
        scripts={scripts}
        teams={teams}
        contactLists={contactLists}
      />
    </>
  );
}
