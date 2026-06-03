import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { ingestTargets, ingestDataTableTargets } from "@/lib/campaign-targets";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const org_id = await requestOrgId(req);

  const { data: campaigns, error } = await sb
    .from("campaigns")
    .select(
      "id,org_id,name,description,agent_handle_id,phone_number_id,caller_id_e164,state,schedule,max_concurrency,max_attempts,retry_delay_min,amd_enabled,metadata,created_at,updated_at",
    )
    .eq("org_id", org_id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Decorate each campaign with target counts (cheap aggregates done client-side).
  const ids = (campaigns ?? []).map((c) => c.id);
  let counts: Record<string, { total: number; done: number; failed: number }> = {};
  if (ids.length > 0) {
    const { data: targets } = await sb
      .from("campaign_targets")
      .select("campaign_id,status")
      .in("campaign_id", ids);
    for (const t of targets ?? []) {
      const id = t.campaign_id as string;
      const c = counts[id] ?? { total: 0, done: 0, failed: 0 };
      c.total += 1;
      if (t.status === "done" || t.status === "answered") c.done += 1;
      if (t.status === "failed") c.failed += 1;
      counts[id] = c;
    }
  }

  // Resolve agent display names in one extra query.
  const handleIds = Array.from(
    new Set((campaigns ?? []).map((c) => c.agent_handle_id).filter(Boolean)),
  ) as string[];
  let handleMap: Record<string, string> = {};
  if (handleIds.length > 0) {
    const { data: handles } = await sb
      .from("agent_handles")
      .select("id,display_name")
      .in("id", handleIds);
    for (const h of handles ?? []) handleMap[h.id as string] = h.display_name as string;
  }

  return NextResponse.json(
    (campaigns ?? []).map((c) => ({
      ...c,
      agent_display_name: handleMap[c.agent_handle_id as string] ?? null,
      target_total: counts[c.id]?.total ?? 0,
      target_done: counts[c.id]?.done ?? 0,
      target_failed: counts[c.id]?.failed ?? 0,
    })),
  );
}

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as {
    org_id?: string;
    name?: string;
    description?: string | null;
    agent_handle_id?: string;
    agent_team_id?: string | null;
    script_id?: string | null;
    contact_list_id?: string | null;
    data_table_id?: string | null;
    mode?: string | null;
    engine?: Record<string, unknown> | null;
    phone_number_id?: string | null;
    caller_id_e164?: string | null;
    schedule?: Record<string, unknown>;
    max_concurrency?: number;
    max_attempts?: number;
    retry_delay_min?: number;
    amd_enabled?: boolean;
    targets?: Array<{ e164: string; name?: string | null }>;
  } | null;
  if (!body?.name) return NextResponse.json({ error: "name requis" }, { status: 400 });
  if (!body.agent_handle_id) {
    return NextResponse.json({ error: "agent_handle_id requis" }, { status: 400 });
  }
  // org_id always derived from session; body.org_id is silently ignored to
  // prevent cross-tenant writes (sprint 6).
  const org_id = await requestOrgId(req);

  const sb = supabaseServer();

  // Defense in depth: when the caller passes an agent_team_id, make sure
  // the team belongs to their org. Otherwise drop it silently rather than
  // 500.
  let resolvedTeamId: string | null = null;
  if (body.agent_team_id) {
    const { data: t } = await sb
      .from("agent_teams")
      .select("id")
      .eq("id", body.agent_team_id)
      .eq("org_id", org_id)
      .maybeSingle();
    if (t) resolvedTeamId = t.id as string;
  }

  // Resolve + verify the data table (if any) belongs to the caller's org.
  let resolvedDataTableId: string | null = null;
  let dataTable: { physical_table: string; phone_column: string; name_column: string | null } | null = null;
  if (body.data_table_id) {
    const { data: dt } = await sb
      .from("tenant_data_tables")
      .select("id, physical_table, phone_column, name_column")
      .eq("id", body.data_table_id)
      .eq("org_id", org_id)
      .maybeSingle();
    if (dt) {
      resolvedDataTableId = dt.id as string;
      dataTable = {
        physical_table: dt.physical_table as string,
        phone_column: dt.phone_column as string,
        name_column: (dt.name_column as string | null) ?? null,
      };
    }
  }

  // Dynamic (continuous) mode requires a data table to re-select from.
  const mode = body.mode === "dynamic" && resolvedDataTableId ? "dynamic" : "static";

  const { data: campaign, error } = await sb
    .from("campaigns")
    .insert({
      org_id,
      name: body.name,
      description: body.description ?? null,
      agent_handle_id: body.agent_handle_id,
      agent_team_id: resolvedTeamId,
      script_id: body.script_id ?? null,
      data_table_id: resolvedDataTableId,
      mode,
      phone_number_id: body.phone_number_id ?? null,
      caller_id_e164: body.caller_id_e164 ?? null,
      state: "draft",
      schedule: body.schedule ?? {},
      max_concurrency: body.max_concurrency ?? 5,
      max_attempts: body.max_attempts ?? 3,
      retry_delay_min: body.retry_delay_min ?? 60,
      amd_enabled: body.amd_enabled ?? true,
      metadata: mode === "dynamic" && body.engine ? { engine: body.engine } : {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed targets from the wizard's CSV / contact picker.
  if (body.targets && body.targets.length > 0) {
    await ingestTargets(sb, org_id, campaign.id, body.targets);
  }

  // STATIC mode only: seed every row of the chosen data table as a fixed
  // target now. In DYNAMIC mode the dialer re-selects from the table at each
  // slot per metadata.engine, so we do NOT pre-seed.
  if (dataTable && mode === "static") {
    try {
      await ingestDataTableTargets(sb, org_id, campaign.id, dataTable);
    } catch (e) {
      console.error("[campaigns] data table seeding failed:", e instanceof Error ? e.message : e);
    }
  }

  // Additionally seed every contact in the chosen Base de Contacts (the
  // primary OCC workflow — pick a base, target it). Verified to belong to
  // the same org before reading.
  if (body.contact_list_id) {
    const { data: listOwn } = await sb
      .from("contact_lists")
      .select("id")
      .eq("id", body.contact_list_id)
      .eq("org_id", org_id)
      .maybeSingle();
    if (listOwn) {
      const { data: rows } = await sb
        .from("contacts")
        .select("e164, display_name")
        .eq("org_id", org_id)
        .eq("list_id", body.contact_list_id);
      const fromList = (rows ?? []).map((r) => ({
        e164: (r as { e164: string }).e164,
        name: (r as { display_name: string | null }).display_name,
      }));
      if (fromList.length > 0) {
        await ingestTargets(sb, org_id, campaign.id, fromList);
      }
    }
  }

  await sb.from("event_log").insert({
    org_id,
    actor_kind: "system",
    entity: "campaign",
    entity_id: campaign.id,
    action: "created",
    payload: { name: campaign.name },
  });

  return NextResponse.json(campaign, { status: 201 });
}

