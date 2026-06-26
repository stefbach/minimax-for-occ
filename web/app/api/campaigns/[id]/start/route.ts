import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import {
  preflightCampaign,
  blockingChecks,
  type PreflightSchedule,
} from "@/lib/sentinel/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Idempotent campaign start.
 *  - Sentinel Wave 1: re-runs the deterministic preflight checks against the
 *    persisted row (this is the safety net for campaigns started via API
 *    without going through the wizard). Returns 409 if any blocker fires.
 *  - Flips state to 'running' (if not already in a terminal state).
 *  - Schedules the first batch by marking up to `max_concurrency` pending targets
 *    with next_attempt_at = now(). The dialer worker picks these up.
 *  - Writes an event_log row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  // Sentinel Wave 1: fetch the full campaign row (plus linked agent + phone
  // number) so the deterministic preflight checks can run server-side.
  type CampaignRow = {
    id: string;
    org_id: string;
    state: string;
    name: string | null;
    max_concurrency: number | null;
    max_attempts: number | null;
    retry_delay_min: number | null;
    amd_enabled: boolean | null;
    schedule: PreflightSchedule | null;
    agent_handle_id: string | null;
    agent_team_id: string | null;
    phone_number_id: string | null;
    caller_id_e164: string | null;
    data_table_id: string | null;
    metadata: { engine?: Record<string, unknown> } | null;
  };
  // public.campaigns has no contact_list_id column — the wizard uses it only
  // at creation time to seed campaign_targets. We pass null to preflight so
  // the 'target_source_set' check leans on data_table_id or actual rows.
  const { data: campaignRaw, error: cErr } = await sb
    .from("campaigns")
    .select(
      "id,org_id,state,name,max_concurrency,max_attempts,retry_delay_min," +
        "amd_enabled,schedule,agent_handle_id,agent_team_id,phone_number_id," +
        "caller_id_e164,data_table_id,metadata",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!campaignRaw) {
    return NextResponse.json({ error: "campagne introuvable" }, { status: 404 });
  }
  const campaign = campaignRaw as unknown as CampaignRow;
  if (campaign.state === "completed" || campaign.state === "cancelled") {
    return NextResponse.json(
      { error: `campagne en état ${campaign.state}, impossible de démarrer` },
      { status: 409 },
    );
  }

  // Resolve the linked agent (via agent_handles → agents) for the prompt +
  // voice checks. Errors are tolerated — a missing row will surface as a
  // failing check, not a 500.
  let agentSnapshot: { system_prompt: string | null; tts_voice_id: string | null } | null = null;
  let isHumanAgent = false;
  if (campaign.agent_handle_id) {
    const { data: handle } = await sb
      .from("agent_handles")
      .select("ai_agent_id, kind")
      .eq("id", campaign.agent_handle_id)
      .eq("org_id", orgId)
      .maybeSingle();
    isHumanAgent = (handle as { kind: string | null } | null)?.kind === "human";
    const aiId = (handle as { ai_agent_id: string | null } | null)?.ai_agent_id ?? null;
    if (aiId) {
      const { data: ag } = await sb
        .from("agents")
        .select("system_prompt,tts_voice_id")
        .eq("id", aiId)
        .maybeSingle();
      const agRow = ag as { system_prompt: string | null; tts_voice_id: string | null } | null;
      if (agRow) {
        agentSnapshot = {
          system_prompt: agRow.system_prompt ?? null,
          tts_voice_id: agRow.tts_voice_id ?? null,
        };
      }
    }
  }

  // Resolve the linked phone number for the active/E.164 check.
  let phoneSnapshot: { active: boolean | null; e164: string | null } | null = null;
  if (campaign.phone_number_id) {
    const { data: pn } = await sb
      .from("phone_numbers")
      .select("active,e164")
      .eq("id", campaign.phone_number_id)
      .eq("org_id", orgId)
      .maybeSingle();
    const pnRow = pn as { active: boolean | null; e164: string | null } | null;
    if (pnRow) {
      phoneSnapshot = { active: pnRow.active, e164: pnRow.e164 };
    }
  }

  // Targets are persisted as `campaign_targets` rows; the wizard's `targets[]`
  // doesn't exist server-side. Use the count as a stand-in so check #6 fires
  // only when the campaign truly has no rows AND no other source set.
  const { count: targetsCount } = await sb
    .from("campaign_targets")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  const result = preflightCampaign({
    name: campaign.name,
    agent_handle_id: campaign.agent_handle_id,
    agent_team_id: campaign.agent_team_id,
    phone_number_id: campaign.phone_number_id,
    caller_id_e164: campaign.caller_id_e164,
    data_table_id: campaign.data_table_id,
    contact_list_id: null,
    csv_text: null,
    targets: Array.from({ length: targetsCount ?? 0 }, () => ({ e164: "+0" })),
    schedule: campaign.schedule,
    max_concurrency: campaign.max_concurrency,
    max_attempts: campaign.max_attempts,
    retry_delay_min: campaign.retry_delay_min,
    amd_enabled: campaign.amd_enabled,
    is_human_agent: isHumanAgent,
    engine: campaign.metadata?.engine ?? null,
    org_id: orgId,
    agent: agentSnapshot,
    phoneNumber: phoneSnapshot,
  });

  const blockers = blockingChecks(result);
  if (blockers.length > 0) {
    return NextResponse.json(
      { error: "preflight_blocked", checks: blockers },
      { status: 409 },
    );
  }

  // Move to running (idempotent — no-op if already running).
  if (campaign.state !== "running") {
    const { error: upErr } = await sb
      .from("campaigns")
      .update({ state: "running", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", orgId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Pick up to max_concurrency targets that have no scheduled attempt yet.
  // campaign_targets has no org_id column — restricting by campaign_id is
  // sufficient because the parent campaign was already org-filtered above.
  const max = campaign.max_concurrency ?? 5;
  const { data: pending } = await sb
    .from("campaign_targets")
    .select("id")
    .eq("campaign_id", id)
    .eq("status", "pending")
    .is("next_attempt_at", null)
    .limit(max);

  const nowIso = new Date().toISOString();
  let scheduled = 0;
  if (pending && pending.length > 0) {
    const ids = pending.map((p) => p.id);
    const { error: schedErr } = await sb
      .from("campaign_targets")
      .update({ next_attempt_at: nowIso })
      .in("id", ids);
    if (schedErr) return NextResponse.json({ error: schedErr.message }, { status: 500 });
    scheduled = ids.length;
  }

  await sb.from("event_log").insert({
    org_id: campaign.org_id,
    actor_kind: "system",
    entity: "campaign",
    entity_id: id,
    action: "started",
    payload: { scheduled },
  });

  return NextResponse.json({ ok: true, state: "running", scheduled });
}
