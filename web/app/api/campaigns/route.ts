import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { ingestTargets } from "@/lib/campaign-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

function orgFrom(req: Request): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("org_id") ?? DEFAULT_ORG;
}

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const org_id = orgFrom(req);

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
  const org_id = body.org_id ?? DEFAULT_ORG;

  const sb = supabaseServer();
  const { data: campaign, error } = await sb
    .from("campaigns")
    .insert({
      org_id,
      name: body.name,
      description: body.description ?? null,
      agent_handle_id: body.agent_handle_id,
      phone_number_id: body.phone_number_id ?? null,
      caller_id_e164: body.caller_id_e164 ?? null,
      state: "draft",
      schedule: body.schedule ?? {},
      max_concurrency: body.max_concurrency ?? 5,
      max_attempts: body.max_attempts ?? 3,
      retry_delay_min: body.retry_delay_min ?? 60,
      amd_enabled: body.amd_enabled ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optionally seed targets at create time (from the wizard's CSV / contact picker).
  if (body.targets && body.targets.length > 0) {
    await ingestTargets(sb, org_id, campaign.id, body.targets);
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

