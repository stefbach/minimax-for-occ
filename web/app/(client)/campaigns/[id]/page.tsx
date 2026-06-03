import { notFound } from "next/navigation";
import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { CampaignDetailClient, type CampaignDetail, type TargetRow } from "@/components/campaigns/CampaignDetailClient";

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

  const { data: targetsRaw } = await sb
    .from("campaign_targets")
    .select(
      "id,status,attempts,last_attempt_at,next_attempt_at,last_call_id,contact_id,contacts(e164,display_name)",
    )
    .eq("campaign_id", id)
    .eq("org_id", orgId)
    .order("status", { ascending: true })
    .limit(2000);

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

  const detail: CampaignDetail = {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    state: campaign.state,
    agent_handle_name: agentName,
    phone_e164: phone?.e164 ?? campaign.caller_id_e164 ?? null,
    max_concurrency: campaign.max_concurrency,
    max_attempts: campaign.max_attempts,
    retry_delay_min: campaign.retry_delay_min,
    amd_enabled: campaign.amd_enabled,
    schedule: campaign.schedule ?? {},
    created_at: campaign.created_at,
  };

  return <CampaignDetailClient campaign={detail} targets={targets} />;
}
