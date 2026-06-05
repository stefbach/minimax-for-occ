import { notFound } from "next/navigation";
import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { CampaignDetailClient, type CampaignDetail, type TargetRow, type CampaignRunRow } from "@/components/campaigns/CampaignDetailClient";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!hasSupabase()) {
    return (
      <div className="card">
        <h3>Supabase non configuré</h3>
        <p className="muted">
          Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY pour consulter la campagne.
        </p>
        <Link href="/campaigns">← Retour</Link>
      </div>
    );
  }

  const orgId = await currentOrgIdForServer();
  const sb = supabaseServer();
  const { data: campaign, error } = await sb
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !campaign) return notFound();

  let agentName: string | null = null;
  if (campaign.agent_handle_id) {
    const { data: ah } = await sb
      .from("agent_handles")
      .select("display_name")
      .eq("id", campaign.agent_handle_id)
      .eq("org_id", orgId)
      .maybeSingle();
    agentName = (ah?.display_name as string) ?? null;
  }
  let phone: { e164: string; label: string | null } | null = null;
  if (campaign.phone_number_id) {
    const { data: pn } = await sb
      .from("phone_numbers")
      .select("e164,label")
      .eq("id", campaign.phone_number_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (pn) phone = pn as any;
  }

  // campaign_targets has no org_id column — tenancy is enforced via the
  // parent campaign_id (the campaign row above was already org-filtered).
  const { data: targetsRaw } = await sb
    .from("campaign_targets")
    .select(
      "id,status,attempts,last_attempt_at,next_attempt_at,last_call_id,contact_id,contacts(e164,display_name)",
    )
    .eq("campaign_id", id)
    .order("status", { ascending: true })
    .limit(2000);

  // Dynamic ("continuous") campaigns log each slot they fire to campaign_runs.
  // Surface the recent history so the user can see the J1/J3/J5-style cadence
  // actually running. Swallowed silently for static campaigns / older deploys.
  let runs: CampaignRunRow[] = [];
  if (campaign.mode === "dynamic") {
    const { data: runsRaw } = await sb
      .from("campaign_runs")
      .select("id,run_date,slot_label,selected,launched,by_phase,started_at,finished_at,error")
      .eq("campaign_id", id)
      .order("started_at", { ascending: false })
      .limit(60);
    runs = (runsRaw ?? []).map((r: any) => ({
      id: r.id,
      run_date: r.run_date,
      slot_label: r.slot_label,
      selected: r.selected,
      launched: r.launched,
      by_phase: (r.by_phase as Record<string, number>) ?? {},
      started_at: r.started_at,
      finished_at: r.finished_at,
      error: r.error,
    }));
  }

  const targets: TargetRow[] = (targetsRaw ?? []).map((t: any) => ({
    id: t.id,
    status: t.status,
    attempts: t.attempts,
    last_attempt_at: t.last_attempt_at,
    next_attempt_at: t.next_attempt_at,
    last_call_id: t.last_call_id,
    contact_id: t.contact_id,
    contact_e164: t.contacts?.e164 ?? null,
    contact_name: t.contacts?.display_name ?? null,
  }));

  const engine = (campaign.metadata as Record<string, unknown> | null)?.engine as
    | Record<string, unknown>
    | undefined;

  const detail: CampaignDetail = {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    state: campaign.state,
    mode: (campaign.mode as string) ?? "static",
    agent_handle_name: agentName,
    agent_handle_id: campaign.agent_handle_id ?? null,
    agent_team_id: (campaign as Record<string, unknown>).agent_team_id as string | null ?? null,
    phone_e164: phone?.e164 ?? campaign.caller_id_e164 ?? null,
    phone_number_id: campaign.phone_number_id ?? null,
    data_table_id: (campaign as Record<string, unknown>).data_table_id as string | null ?? null,
    max_concurrency: campaign.max_concurrency,
    max_attempts: campaign.max_attempts,
    retry_delay_min: campaign.retry_delay_min,
    amd_enabled: campaign.amd_enabled,
    schedule: campaign.schedule ?? {},
    metadata: (campaign.metadata as Record<string, unknown> | null) ?? null,
    created_at: campaign.created_at,
    engine: engine
      ? {
          timezone: ((engine.slots as any)?.timezone as string) ?? "UTC",
          days: ((engine.slots as any)?.days as number[]) ?? [],
          hours: ((engine.slots as any)?.hours as string[]) ?? [],
          max_new_per_day: ((engine.volume as any)?.max_new_per_day as number) ?? null,
          include_statuses: ((engine.selection as any)?.include_statuses as string[]) ?? [],
          phases: (((engine.cadence as any)?.phases as any[]) ?? []).map((p) => String(p?.name)),
        }
      : null,
  };

  return <CampaignDetailClient campaign={detail} targets={targets} runs={runs} />;
}
