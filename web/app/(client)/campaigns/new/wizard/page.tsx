import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { CampaignWizard, type AgentHandleOption, type PhoneNumberOption, type ContactOption, type ScriptOption, type TeamOption, type ContactListOption, type DataTableOption } from "@/components/campaigns/CampaignWizard";
import { HelpButton } from "@/components/help/HelpButton";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { getTemplate } from "@/lib/campaign-templates";

export const dynamic = "force-dynamic";

export default async function NewCampaignWizardPage({
  searchParams,
}: {
  searchParams?: Promise<{ template?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const template = getTemplate(sp.template);

  let agents: AgentHandleOption[] = [];
  let numbers: PhoneNumberOption[] = [];
  let contacts: ContactOption[] = [];
  let scripts: ScriptOption[] = [];
  let teams: TeamOption[] = [];
  let contactLists: ContactListOption[] = [];
  let dataTables: DataTableOption[] = [];

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
    } catch { /* ignore */ }
    try {
      const { data } = await sb
        .from("phone_numbers")
        .select("id,e164,label,active")
        .eq("org_id", DEFAULT_ORG)
        .eq("active", true)
        .order("e164", { ascending: true })
        .limit(200);
      numbers = (data ?? []) as PhoneNumberOption[];
    } catch { /* ignore */ }
    try {
      const { data } = await sb
        .from("contacts")
        .select("id,e164,display_name")
        .eq("org_id", DEFAULT_ORG)
        .order("updated_at", { ascending: false })
        .limit(500);
      contacts = (data ?? []) as ContactOption[];
    } catch { /* ignore */ }
    try {
      const { data } = await sb
        .from("scripts")
        .select("id,name,mission,description")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(200);
      scripts = (data ?? []) as ScriptOption[];
    } catch { /* ignore */ }
    try {
      const { data: ts } = await sb
        .from("agent_teams")
        .select("id,name,description,lead_agent_id")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(100);
      const teamRows = (ts ?? []) as Array<{
        id: string; name: string; description: string | null; lead_agent_id: string | null;
      }>;
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
    } catch { /* ignore */ }
    try {
      const { data } = await sb
        .from("tenant_data_tables")
        .select("id,label,physical_table,columns,phone_column")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(200);
      const tbls = (data ?? []) as Array<{
        id: string; label: string; physical_table: string;
        columns: Array<{ key: string; label: string; type: string }>; phone_column: string;
      }>;
      const withCounts: typeof dataTables = [];
      for (const t of tbls) {
        let count = 0;
        try {
          const { count: c } = await sb
            .from(t.physical_table)
            .select("id", { count: "exact", head: true });
          count = c ?? 0;
        } catch {
          count = 0;
        }
        withCounts.push({
          id: t.id, label: t.label, physical_table: t.physical_table, row_count: count,
          columns: Array.isArray(t.columns) ? t.columns : [],
          phone_column: t.phone_column,
        });
      }
      dataTables = withCounts;
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{template ? template.title : "Nouvelle campagne"}</h1>
          <div className="subtitle">
            {template ? (
              <>Modèle <strong>{template.emoji} {template.title}</strong> — pré-rempli, à ajuster.{" "}
                <Link href="/campaigns/new" style={{ color: "var(--accent)" }}>changer de modèle</Link>
              </>
            ) : (
              <>Mode avancé — toute la configuration est éditable.{" "}
                <Link href="/campaigns/new" style={{ color: "var(--accent)" }}>retour aux modèles</Link>
              </>
            )}
          </div>
        </div>
        <HelpButton contextKey="campaigns" />
      </div>
      <CampaignWizard
        template={template}
        agents={agents}
        numbers={numbers}
        contacts={contacts}
        scripts={scripts}
        teams={teams}
        contactLists={contactLists}
        dataTables={dataTables}
      />
    </>
  );
}
